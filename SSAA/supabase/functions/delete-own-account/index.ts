import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: claims, error: claimsError } = await supabaseAuth.auth.getClaims(
      authHeader.replace("Bearer ", "")
    );
    if (claimsError || !claims?.claims) return json({ error: "Unauthorized" }, 401);
    const authenticatedId = claims.claims.sub as string;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Optional body: operators can target another user (impersonation delete).
    let targetUserId: string | null = null;
    try {
      const body = req.headers.get("content-length") && Number(req.headers.get("content-length")) > 0
        ? await req.json()
        : null;
      if (body && typeof body.target_user_id === "string") {
        targetUserId = body.target_user_id;
      }
    } catch { /* no body */ }

    // Load authenticated caller
    const { data: authProfile } = await supabase
      .from("profiles")
      .select("id, user_id, email, role, company_id")
      .eq("user_id", authenticatedId)
      .maybeSingle();
    if (!authProfile) return json({ error: "Profile not found" }, 404);

    // Resolve the effective caller (the account being deleted).
    // Only operators may target another user; non-operators may only delete themselves.
    let callerId = authenticatedId;
    if (targetUserId && targetUserId !== authenticatedId) {
      if (authProfile.role !== "moa") {
        return json({ error: "Only operators can delete another user's account." }, 403);
      }
      callerId = targetUserId;
    }

    const { data: callerProfile } = await supabase
      .from("profiles")
      .select("id, user_id, email, role, company_id")
      .eq("user_id", callerId)
      .maybeSingle();
    if (!callerProfile) return json({ error: "Profile not found" }, 404);
    // Operators may not self-delete; the impersonation path targets a different user, so it's allowed.
    if (callerProfile.role === "moa" && callerId === authenticatedId)
      return json({ error: "Operators cannot self-delete via this endpoint." }, 403);

    const companyId = callerProfile.company_id as string | null;
    if (!companyId) {
      // No company — just delete profile + auth user
      await supabase.from("profiles").delete().eq("user_id", callerId);
      await supabase.auth.admin.deleteUser(callerId);
      return json({ success: true, mode: "lone_user" });
    }

    // Load company info
    const { data: company } = await supabase
      .from("companies")
      .select("id, name, is_guest")
      .eq("id", companyId)
      .single();
    const isGuest = !!company?.is_guest;

    // Count remaining non-MOA members in this company
    const { data: members } = await supabase
      .from("profiles")
      .select("user_id, role")
      .eq("company_id", companyId);
    const otherMembers = (members || []).filter(
      (m) => m.user_id !== callerId && m.role !== "moa"
    );
    const isLastUser = otherMembers.length === 0;

    // If NOT last user: guard sole-account-holder
    if (!isLastUser) {
      const { data: callerRoles } = await supabase
        .from("user_roles")
        .select("permission_level")
        .eq("user_id", callerId)
        .eq("company_id", companyId);
      const isAccountHolder = (callerRoles || []).some(
        (r) => r.permission_level === "account_holder"
      );
      if (isAccountHolder) {
        const { data: otherHolders } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("company_id", companyId)
          .eq("permission_level", "account_holder")
          .neq("user_id", callerId);
        if ((otherHolders || []).length === 0) {
          return json(
            {
              error:
                "You're the only Main Company Account Holder. Please designate another account holder before deleting your profile.",
            },
            409
          );
        }
      }

      // Delete caller's records only
      await supabase.from("employees").delete().eq("linked_user_id", callerId);
      await supabase
        .from("user_project_assignments")
        .delete()
        .eq("user_id", callerId)
        .eq("company_id", companyId);
      await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", callerId)
        .eq("company_id", companyId);
      await supabase
        .from("profile_email_sync_queue")
        .delete()
        .eq("user_id", callerId);
      await supabase.from("profiles").delete().eq("user_id", callerId);
      await supabase.auth.admin.deleteUser(callerId);

      await supabase.from("notification_log").insert({
        event_type: "self_account_delete_member",
        channel: "system",
        recipient_company_id: companyId,
        recipient_email: callerProfile.email,
        metadata: { caller_user_id: callerId, last_user: false },
      });

      return json({ success: true, mode: "member_only" });
    }

    // LAST USER path — cascade-delete the company itself
    const { data: companyProjects } = await supabase
      .from("projects")
      .select("id")
      .eq("company_id", companyId);
    const projectIds = (companyProjects || []).map((p) => p.id);

    if (isGuest) {
      // Preserve projects for connected Subs: snapshot owner name + detach company_id.
      // We intentionally PRESERVE for guest deletes:
      //   - project_connections  (Subs keep RLS access via is_connected_to_project)
      //   - tasks                (historical schedule context tied to the project)
      // Schedule_requests are still cleared below because they reference this
      // (now-vanished) guest as requesting_company_id; Sub-side rows already
      // carry guest_gc_company_name / guest_gc_project_name snapshots elsewhere.
      if (projectIds.length > 0) {
        await supabase
          .from("projects")
          .update({
            company_id: null,
            owner_display_name: company?.name || "Former Guest Account",
          })
          .in("id", projectIds);
      }
    } else {
      // Full GC/Sub last-user: drop project connections and tasks fully.
      if (projectIds.length > 0) {
        await supabase.from("project_connections").delete().in("project_id", projectIds);
        await supabase.from("tasks").delete().in("project_id", projectIds);
      }
    }

    // Schedule requests touching this company
    await supabase
      .from("schedule_requests")
      .delete()
      .or(`requesting_company_id.eq.${companyId},sub_company_id.eq.${companyId}`);

    // Employees + employee-scoped data
    const { data: companyEmployees } = await supabase
      .from("employees")
      .select("id")
      .eq("company_id", companyId);
    const empIds = (companyEmployees || []).map((e) => e.id);
    if (empIds.length > 0) {
      await supabase.from("availability").delete().in("employee_id", empIds);
      await supabase.from("employee_project_assignments").delete().in("employee_id", empIds);
    }
    await supabase.from("employee_project_assignments").delete().eq("company_id", companyId);
    await supabase.from("user_project_assignments").delete().eq("company_id", companyId);

    if (isGuest) {
      // Guest cleanup: only remove this guest's outbound mappings.
      // Do NOT touch project_connections — Subs must retain visibility on the
      // now-orphaned projects we just detached above.
      await supabase
        .from("guest_project_connections")
        .delete()
        .eq("guest_company_id", companyId);
    } else {
      await supabase.from("project_connections").delete().eq("sub_company_id", companyId);
      await supabase
        .from("guest_project_connections")
        .delete()
        .or(`guest_company_id.eq.${companyId},sub_company_id.eq.${companyId}`);
      await supabase.from("guest_gc_links").delete().eq("sub_company_id", companyId);
    }

    await supabase.from("company_join_requests").delete().eq("company_id", companyId);
    await supabase.from("employees").delete().eq("company_id", companyId);
    await supabase.from("company_subscriptions").delete().eq("company_id", companyId);
    await supabase.from("notification_preferences").delete().eq("company_id", companyId);
    await supabase.from("user_roles").delete().eq("company_id", companyId);

    // Non-guest: now safe to delete projects entirely
    if (!isGuest && projectIds.length > 0) {
      await supabase.from("projects").delete().in("id", projectIds);
    }

    // Profiles + auth users
    const userIds = (members || []).map((m) => m.user_id);
    if (userIds.length > 0) {
      await supabase.from("profile_email_sync_queue").delete().in("user_id", userIds);
    }
    await supabase.from("profiles").delete().eq("company_id", companyId);
    for (const uid of userIds) {
      try {
        await supabase.auth.admin.deleteUser(uid);
      } catch (e) {
        console.error("auth delete failed for", uid, e);
      }
    }

    await supabase.from("company_deletion_requests").delete().eq("company_id", companyId);
    await supabase.from("companies").delete().eq("id", companyId);

    await supabase.from("notification_log").insert({
      event_type: isGuest ? "self_account_delete_guest_last" : "self_account_delete_full_last",
      channel: "system",
      recipient_email: callerProfile.email,
      metadata: { company_id: companyId, last_user: true, is_guest: isGuest },
    });

    return json({ success: true, mode: isGuest ? "guest_last_user" : "full_last_user" });
  } catch (e: any) {
    console.error("delete-own-account error:", e);
    return json({ error: e.message || "Failed to delete account" }, 500);
  }
});
