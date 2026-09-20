import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const isUUID = (s: unknown) =>
  typeof s === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const isEmail = (s: unknown) =>
  typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 255;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user = userRes.user;

    const body = await req.json().catch(() => ({}));
    const target_company_id = body?.target_company_id;
    const update_email = body?.update_email ? String(body.update_email).trim().toLowerCase() : null;
    const update_phone = body?.update_phone ? String(body.update_phone).trim() : null;
    const merge_on_approval = body?.merge_on_approval === true;

    if (!isUUID(target_company_id)) {
      return new Response(JSON.stringify({ error: "Invalid target_company_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (update_email !== null && !isEmail(update_email)) {
      return new Response(JSON.stringify({ error: "Invalid email" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load requester profile + guest company
    const { data: profile } = await admin
      .from("profiles")
      .select("user_id, email, full_name, phone, company_id")
      .eq("user_id", user.id)
      .single();
    if (!profile?.company_id) {
      return new Response(JSON.stringify({ error: "No current company" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: currentCompany } = await admin
      .from("companies")
      .select("id, name, is_guest, company_type")
      .eq("id", profile.company_id)
      .single();
    if (!currentCompany?.is_guest) {
      return new Response(JSON.stringify({ error: "Only Guest Accounts can use this flow" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: targetCompany } = await admin
      .from("companies")
      .select("id, name, is_guest, company_type")
      .eq("id", target_company_id)
      .single();
    if (!targetCompany || targetCompany.is_guest || targetCompany.company_type !== "gc") {
      return new Response(JSON.stringify({ error: "Target must be a registered GC company" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Reject if existing pending request for same company
    const { data: existing } = await admin
      .from("company_join_requests")
      .select("id")
      .eq("user_id", user.id)
      .eq("company_id", target_company_id)
      .eq("status", "pending")
      .maybeSingle();
    if (existing) {
      return new Response(
        JSON.stringify({ error: "A pending request to this company already exists" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Count guest company members; force merge=false if more than one
    const { count: memberCount } = await admin
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .eq("company_id", profile.company_id);
    const effectiveMerge = merge_on_approval && (memberCount ?? 0) <= 1;

    // Update email/phone on profile if requested (profile_email_sync_queue trigger handles auth sync)
    const profileUpdates: Record<string, unknown> = {};
    if (update_email && update_email !== (profile.email || "").toLowerCase()) {
      profileUpdates.email = update_email;
    }
    if (update_phone !== null && update_phone !== (profile.phone || "")) {
      profileUpdates.phone = update_phone;
    }
    if (Object.keys(profileUpdates).length > 0) {
      await admin.from("profiles").update(profileUpdates).eq("user_id", user.id);
    }

    const finalEmail = (profileUpdates.email as string) || profile.email;
    const finalName = profile.full_name || finalEmail;

    // Insert the join request
    const { data: inserted, error: insertErr } = await admin
      .from("company_join_requests")
      .insert({
        user_id: user.id,
        company_id: target_company_id,
        user_email: finalEmail,
        user_name: finalName,
        metadata: {
          merge: effectiveMerge,
          source_guest_company_id: profile.company_id,
          source_guest_company_name: currentCompany.name,
        },
      })
      .select("id")
      .single();

    if (insertErr) {
      return new Response(JSON.stringify({ error: insertErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Notify account holder (fire and forget)
    try {
      await admin.functions.invoke("notify-join-request", {
        body: { requestId: inserted.id, action: "submitted" },
      });
    } catch (e) {
      console.error("notify-join-request failed", e);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        request_id: inserted.id,
        merge: effectiveMerge,
        merge_downgraded: merge_on_approval && !effectiveMerge,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("request-join-existing-company error", e);
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
