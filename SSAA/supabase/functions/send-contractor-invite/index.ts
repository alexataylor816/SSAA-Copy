import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 255;
}

function escapeHtml(u: string): string {
  return u.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

interface Body {
  invited_company_name: string;
  recipient_emails: string[];
  acting_company_id?: string | null;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Auth: identify caller and derive inviting company from their profile
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const authed = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await authed.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const admin = createClient(supabaseUrl, serviceKey);
    const body = await req.json() as Body;

    const { data: profile } = await admin.from("profiles").select("company_id, full_name, email").eq("user_id", userData.user.id).maybeSingle();

    // Operators acting as a company (impersonation) may invite on that company's behalf.
    // Operators are either on the roster table or hold an MOA profile role.
    let actingCompanyId: string | null = profile?.company_id ?? null;
    if (body.acting_company_id) {
      const { data: op } = await admin.from("operators").select("id").eq("user_id", userData.user.id).maybeSingle();
      const { data: roleRow } = await admin.from("profiles").select("role").eq("user_id", userData.user.id).maybeSingle();
      if (op || roleRow?.role === "moa") actingCompanyId = body.acting_company_id;
    }


    if (!actingCompanyId) {
      return new Response(JSON.stringify({ error: "no company" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: company } = await admin.from("companies").select("name, company_type").eq("id", actingCompanyId).maybeSingle();
    if (!company || company.company_type !== "sub") {
      return new Response(JSON.stringify({ error: "sub companies only" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const invitedName = (body.invited_company_name || "").trim();
    const emails = (body.recipient_emails || []).map(e => (e || "").trim().toLowerCase()).filter(Boolean);
    if (!invitedName || invitedName.length > 255) {
      return new Response(JSON.stringify({ error: "invited_company_name required (max 255)" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (emails.length === 0 || emails.length > 20) {
      return new Response(JSON.stringify({ error: "recipient_emails must be 1-20" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    for (const e of emails) {
      if (!isValidEmail(e)) {
        return new Response(JSON.stringify({ error: `invalid email: ${e}` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Persist the invite row (audit + future conversion)
    const token = crypto.randomUUID();
    await admin.from("contractor_invites").insert({
      inviting_company_id: actingCompanyId,
      company_name: invitedName,
      emails,
      token,
      status: "sent",
      created_by: userData.user.id,
    });

    // Load the active connected-contractor join invite template.
    // If it is missing or deactivated, no email is sent — deactivation means silence.
    const { data: tpl } = await admin.from("notification_templates")
      .select("subject, body_html")
      .eq("event_type", "contractor_invite_new")
      .eq("channel", "email")
      .eq("is_active", true)
      .maybeSingle();

    if (!tpl) {
      return new Response(JSON.stringify({ ok: true, skipped: "template_inactive", results: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const safeInviter = escapeHtml(company.name || "A subcontractor");
    const safeInvited = escapeHtml(invitedName);
    const signInUrl = "https://ssaainc.com/";

    const subject = tpl.subject
      .replace(/\{inviting_company_name\}/g, safeInviter)
      .replace(/\{invited_company_name\}/g, safeInvited)
      .replace(/\{invitee_company_name\}/g, safeInvited);
    const htmlBody = tpl.body_html
      .replace(/\{inviting_company_name\}/g, safeInviter)
      .replace(/\{invited_company_name\}/g, safeInvited)
      .replace(/\{invitee_company_name\}/g, safeInvited)
      .replace(/\{invite_link\}/g, signInUrl)
      .replace(/\{sign_in_url\}/g, signInUrl);

    const results: { email: string; ok: boolean; error?: string }[] = [];
    for (const to of emails) {
      try {
        const res = await resend.emails.send({
          from: "SSAA <notify@ssaainc.com>",
          to: [to],
          subject,
          html: htmlBody,
        });
        results.push({ email: to, ok: !res.error, error: res.error?.message });
      } catch (e) {
        results.push({ email: to, ok: false, error: (e as Error).message });
      }
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-contractor-invite error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
};

serve(handler);
