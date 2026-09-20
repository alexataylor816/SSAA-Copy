import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  token: string;
  password: string;
  full_name?: string;
  email?: string;
  phone?: string;
  job_title?: string;
  gc_company_name?: string;
  project_name?: string;
  project_address?: string;
}

function check<T>(label: string, res: { error: any; data?: T }): T | undefined {
  if (res.error) throw new Error(`${label} failed: ${res.error.message}`);
  return res.data;
}

async function notifyAccountHolderSeatLimit(params: {
  supabase: any;
  companyId: string;
  companyName: string;
  invitee: { name: string; email: string; phone: string | null; jobTitle: string | null };
  projectName: string;
  maxUsers: number;
}) {
  const { supabase, companyId, companyName, invitee, projectName, maxUsers } = params;

  // Find the account holder for this guest company
  const { data: roles } = await supabase
    .from("user_roles")
    .select("user_id")
    .eq("company_id", companyId)
    .eq("permission_level", "account_holder")
    .limit(1);

  const holderUserId = roles?.[0]?.user_id;
  if (!holderUserId) {
    console.warn("No account holder found for guest company", companyId);
    return;
  }

  const { data: holderProfile } = await supabase
    .from("profiles")
    .select("email, full_name")
    .eq("user_id", holderUserId)
    .maybeSingle();

  const holderEmail = holderProfile?.email;
  if (!holderEmail) {
    console.warn("No account holder email for guest company", companyId);
    return;
  }

  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) {
    console.warn("RESEND_API_KEY missing — cannot notify account holder");
    return;
  }
  const resend = new Resend(RESEND_API_KEY);
  const sender = Deno.env.get("SENDER_EMAIL") || "SSAA <noreply@ssaainc.com>";

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const subject = `Action needed: ${companyName} has reached its user limit`;
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="margin:0 0 12px;">A new user couldn't join ${esc(companyName)}</h2>
      <p>Hi ${esc(holderProfile?.full_name || "there")},</p>
      <p>
        Someone tried to accept an invite to join <strong>${esc(companyName)}</strong>
        on the project <strong>${esc(projectName)}</strong>, but your account has reached its
        current limit of <strong>${maxUsers}</strong> users and the new account could not be created.
      </p>
      <h3 style="margin-top:24px;margin-bottom:8px;">Who tried to join</h3>
      <ul style="line-height:1.6;">
        <li><strong>Name:</strong> ${esc(invitee.name)}</li>
        <li><strong>Email:</strong> ${esc(invitee.email)}</li>
        ${invitee.phone ? `<li><strong>Phone:</strong> ${esc(invitee.phone)}</li>` : ""}
        ${invitee.jobTitle ? `<li><strong>Job title:</strong> ${esc(invitee.jobTitle)}</li>` : ""}
        <li><strong>Project:</strong> ${esc(projectName)}</li>
      </ul>
      <p style="margin-top:20px;">
        To let them in, please upgrade your plan or remove an existing user, then resend the invite.
      </p>
      <p style="font-size:12px;color:#aaa;margin-top:24px;padding-top:16px;border-top:1px solid #eee;">— The SSAA Team</p>
    </div>
  `;

  try {
    await resend.emails.send({ from: sender, to: [holderEmail], subject, html });
    await supabase.from("notification_log").insert({
      event_type: "guest_account_seat_limit_reached",
      channel: "email",
      recipient_email: holderEmail,
      recipient_company_id: companyId,
      subject,
      status: "sent",
      metadata: { invitee, project_name: projectName, max_users: maxUsers },
    });
  } catch (err: any) {
    console.error("Failed to send seat-limit email:", err);
    await supabase.from("notification_log").insert({
      event_type: "guest_account_seat_limit_reached",
      channel: "email",
      recipient_email: holderEmail,
      recipient_company_id: companyId,
      subject,
      status: "failed",
      error_message: err?.message || String(err),
      metadata: { invitee, project_name: projectName, max_users: maxUsers },
    });
  }
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body: Body = await req.json();
    if (!body.token || !body.password || body.password.length < 8) {
      throw new Error("Token and a password (min 8 chars) are required");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Look up prefill
    const { data: prefill, error: pfErr } = await supabase
      .from("gc_invite_prefills")
      .select("*")
      .eq("invite_token", body.token)
      .single();
    if (pfErr || !prefill) throw new Error("Invalid or expired invite token");
    if (prefill.accepted_at) throw new Error("This invite has already been used");

    const finalEmail = (body.email || prefill.invitee_email).trim().toLowerCase();
    const finalFullName = (body.full_name || prefill.invitee_full_name).trim();
    const finalPhone = (body.phone || prefill.invitee_phone || "").trim() || null;
    const finalJobTitle = (body.job_title || prefill.invitee_job_title || "").trim() || null;
    const finalCompanyName = (body.gc_company_name || prefill.gc_company_name).trim();
    const finalProjectName = (body.project_name || prefill.project_name).trim();
    const finalProjectAddress = (body.project_address || prefill.project_address || "").trim() || null;

    // 2. Find existing guest GC company (account merge by name)
    const { data: existingCompanies } = await supabase
      .from("companies")
      .select("id, name, is_guest")
      .eq("is_guest", true)
      .eq("company_type", "gc");

    const matchedCompany = existingCompanies?.find(
      (c) => c.name.trim().toLowerCase() === finalCompanyName.toLowerCase()
    );

    let companyId: string;
    let isNewCompany = false;
    if (matchedCompany) {
      companyId = matchedCompany.id;
    } else {
      const newCompany = check<{ id: string }>(
        "Create company",
        await supabase
          .from("companies")
          .insert({
            name: finalCompanyName,
            company_type: "gc",
            is_guest: true,
            subscription_status: "active",
          })
          .select("id")
          .single(),
      )!;
      companyId = newCompany.id;
      isNewCompany = true;

      const { data: guestPlan } = await supabase
        .from("subscription_plans")
        .select("id")
        .eq("name", "guest_gc")
        .maybeSingle();
      if (guestPlan) {
        check("Create company subscription", await supabase.from("company_subscriptions").insert({
          company_id: companyId,
          plan_id: guestPlan.id,
          status: "active",
          billing_cycle: "monthly",
        }));
      }
    }

    // 2b. SEAT LIMIT PRE-CHECK (only for merge into existing company; brand-new companies always allow first user)
    if (!isNewCompany) {
      const { data: planRow } = await supabase
        .from("subscription_plans")
        .select("max_users")
        .eq("name", "guest_gc")
        .maybeSingle();
      const maxUsers = planRow?.max_users ?? 5;

      // Count current employees in this guest company, excluding any row already
      // belonging to this invitee's email (so a re-acceptance still works).
      const { data: existingEmps } = await supabase
        .from("employees")
        .select("id,email")
        .eq("company_id", companyId);
      const currentCount = (existingEmps || []).filter(
        (e: any) => (e.email || "").toLowerCase() !== finalEmail,
      ).length;

      if (currentCount >= maxUsers) {
        // Notify the account holder and abort acceptance — no auth user, no employee row.
        await notifyAccountHolderSeatLimit({
          supabase,
          companyId,
          companyName: finalCompanyName,
          invitee: { name: finalFullName, email: finalEmail, phone: finalPhone, jobTitle: finalJobTitle },
          projectName: finalProjectName,
          maxUsers,
        });
        throw new Error(
          `This account has reached its limit of ${maxUsers} users. The account holder has been notified and can upgrade the plan or remove an existing user before you try again.`,
        );
      }
    }

    // 3. Find (or create) the Sub's canonical project
    let projectId: string | null = null;

    // 3a. HIGHEST PRIORITY: if this guest GC already has any alias on a project
    // owned by this Sub, reuse that project. Guarantees additional invitees to the
    // same guest GC always land on the same Sub project (no duplicate Sub projects).
    if (!isNewCompany) {
      const { data: guestAliasRows } = await supabase
        .from("project_aliases")
        .select("project_id, projects:projects!inner(id, company_id)")
        .eq("company_id", companyId);
      const match = (guestAliasRows || []).find(
        (r: any) => r.projects?.company_id === prefill.sub_company_id,
      );
      if (match?.project_id) projectId = match.project_id as string;
    }

    if (!projectId) {
      const { data: subAliasMatch } = await supabase
        .from("project_aliases")
        .select("project_id, projects:projects!inner(id, company_id)")
        .eq("company_id", prefill.sub_company_id)
        .ilike("name", prefill.project_name)
        .maybeSingle();
      if (subAliasMatch?.project_id) projectId = subAliasMatch.project_id as string;
    }

    if (!projectId) {
      const { data: subProject } = await supabase
        .from("projects")
        .select("id")
        .eq("company_id", prefill.sub_company_id)
        .ilike("name", prefill.project_name)
        .maybeSingle();
      if (subProject?.id) projectId = subProject.id as string;
    }

    if (!projectId) {
      const newProject = check<{ id: string }>(
        "Create project",
        await supabase
          .from("projects")
          .insert({
            name: prefill.project_name,
            address: prefill.project_address,
            company_id: prefill.sub_company_id,
          })
          .select("id")
          .single(),
      )!;
      projectId = newProject.id;
    }

    // 4. Create (or fetch) auth user
    let userId: string;
    const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
      email: finalEmail,
      password: body.password,
      email_confirm: true,
      user_metadata: { full_name: finalFullName, company_id: companyId },
    });

    if (authErr) {
      if (authErr.message.toLowerCase().includes("already") || authErr.message.toLowerCase().includes("exists")) {
        const { data: list } = await supabase.auth.admin.listUsers();
        const existing = list?.users?.find((u: any) => u.email?.toLowerCase() === finalEmail);
        if (!existing) throw new Error(authErr.message);
        userId = existing.id;
        await supabase.auth.admin.updateUserById(userId, { password: body.password });
      } else {
        throw new Error(authErr.message);
      }
    } else {
      userId = authUser!.user!.id;
    }

    // 5. Upsert profile
    check("Upsert profile", await supabase
      .from("profiles")
      .upsert(
        {
          user_id: userId,
          email: finalEmail,
          full_name: finalFullName,
          phone: finalPhone,
          role: "admin",
          company_id: companyId,
          force_password_change: false,
        },
        { onConflict: "user_id" }
      ));

    // 6. user_roles
    const { data: existingRole } = await supabase
      .from("user_roles")
      .select("id")
      .eq("user_id", userId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (!existingRole) {
      // Guest accounts have no permission-management UI, so every user on a
      // guest company is a Main Company Account Holder. When they upgrade to
      // a full company they'll be able to demote each other from Manage Team.
      check("Insert user_role", await supabase.from("user_roles").insert({
        user_id: userId,
        company_id: companyId,
        permission_level: "account_holder",
        is_company_creator: isNewCompany,
      }));
    } else {
      // Ensure existing rows on a guest company are also account_holder.
      await supabase
        .from("user_roles")
        .update({ permission_level: "account_holder" })
        .eq("id", existingRole.id);
    }

    // 6b. employees roster
    const { data: existingEmp } = await supabase
      .from("employees")
      .select("id, linked_user_id")
      .eq("company_id", companyId)
      .or(`linked_user_id.eq.${userId},email.eq.${finalEmail}`)
      .maybeSingle();

    if (!existingEmp) {
      check("Insert employee", await supabase.from("employees").insert({
        company_id: companyId,
        name: finalFullName,
        email: finalEmail,
        phone: finalPhone,
        job_title: finalJobTitle,
        linked_user_id: userId,
      }));
    } else if (!existingEmp.linked_user_id) {
      check("Link employee", await supabase
        .from("employees")
        .update({ linked_user_id: userId })
        .eq("id", existingEmp.id));
    }

    // 7. project_connections
    const { data: existingConn } = await supabase
      .from("project_connections")
      .select("id")
      .eq("project_id", projectId)
      .eq("sub_company_id", prefill.sub_company_id)
      .maybeSingle();
    if (!existingConn) {
      check("Insert project_connection", await supabase.from("project_connections").insert({
        project_id: projectId,
        sub_company_id: prefill.sub_company_id,
      }));
    }

    // 7b. guest_project_connections
    const { data: existingGuestConn } = await supabase
      .from("guest_project_connections")
      .select("id")
      .eq("guest_company_id", companyId)
      .eq("sub_company_id", prefill.sub_company_id)
      .maybeSingle();
    if (!existingGuestConn) {
      check("Insert guest_project_connection", await supabase.from("guest_project_connections").insert({
        guest_company_id: companyId,
        sub_company_id: prefill.sub_company_id,
      }));
    }

    // 7c. project_aliases (guest snapshot)
    check("Upsert project_alias", await supabase
      .from("project_aliases")
      .upsert(
        {
          project_id: projectId,
          company_id: companyId,
          name: finalProjectName,
          address: finalProjectAddress,
        },
        { onConflict: "project_id,company_id" },
      ));

    // 8. Mark prefill accepted
    check("Mark prefill accepted", await supabase
      .from("gc_invite_prefills")
      .update({
        accepted_at: new Date().toISOString(),
        created_company_id: companyId,
        created_project_id: projectId,
        created_user_id: userId,
      })
      .eq("id", prefill.id));

    return new Response(
      JSON.stringify({ success: true, email: finalEmail, company_id: companyId, project_id: projectId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("create-guest-gc-from-invite error:", e);
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
};

serve(handler);
