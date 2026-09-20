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

interface Recipient { name?: string; email: string }
interface Body {
  connection_id: string;
  project_id: string;
  acting_company_id?: string | null;
  recipients: Recipient[];
  custom_message?: string | null;
}

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

    const authed = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await authed.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const body = await req.json() as Body;

    if (!body?.connection_id || !body?.project_id) return json({ error: "connection_id and project_id are required" }, 400);

    const recipients = (body.recipients || [])
      .map((r) => ({ name: (r?.name || "").trim().slice(0, 120), email: (r?.email || "").trim().toLowerCase() }))
      .filter((r) => r.email);
    if (recipients.length === 0 || recipients.length > 20) return json({ error: "recipients must be 1-20" }, 400);
    for (const r of recipients) {
      if (!isValidEmail(r.email)) return json({ error: `invalid email: ${r.email}` }, 400);
    }
    const customMessage = (body.custom_message || "").trim().slice(0, 1000);

    // Resolve acting company (operators may act on behalf of a company)
    let actingCompanyId: string | null = null;
    let resolveError: string | null = null;

    const { data: rpcCompany, error: rpcErr } = await authed.rpc("resolve_acting_company", {
      p_acting_company_id: body.acting_company_id ?? null,
    } as any);
    if (rpcErr) resolveError = rpcErr.message;
    if (typeof rpcCompany === "string" && rpcCompany) actingCompanyId = rpcCompany;

    if (!actingCompanyId) {
      const { data: profile } = await admin.from("profiles").select("company_id").eq("user_id", userData.user.id).maybeSingle();
      actingCompanyId = profile?.company_id ?? null;
      if (body.acting_company_id) {
        const { data: op } = await admin.from("operators").select("id").eq("user_id", userData.user.id).maybeSingle();
        if (op) actingCompanyId = body.acting_company_id;
      }
    }

    // Last resort: derive from the connection itself when the caller belongs to one of its companies
    if (!actingCompanyId) {
      const { data: c } = await admin
        .from("contractor_connections")
        .select("company_a_id, company_b_id")
        .eq("id", body.connection_id)
        .maybeSingle();
      const { data: prof2 } = await admin.from("profiles").select("company_id").eq("user_id", userData.user.id).maybeSingle();
      if (c && prof2?.company_id && (c.company_a_id === prof2.company_id || c.company_b_id === prof2.company_id)) {
        actingCompanyId = prof2.company_id;
      }
    }

    console.log("send-project-connection-code", JSON.stringify({
      caller: userData.user.id,
      supplied_acting_company_id: body.acting_company_id ?? null,
      resolved_acting_company_id: actingCompanyId,
      resolve_error: resolveError,
    }));

    if (!actingCompanyId) {
      return json({ error: `Unable to determine which company you are sending as${resolveError ? ` (${resolveError})` : ""}` }, 400);
    }


    // Validate connection
    const { data: conn } = await admin
      .from("contractor_connections")
      .select("id, company_a_id, company_b_id, status")
      .eq("id", body.connection_id)
      .maybeSingle();
    if (!conn || (conn.company_a_id !== actingCompanyId && conn.company_b_id !== actingCompanyId)) {
      return json({ error: "connection not found" }, 403);
    }
    if (conn.status !== "accepted") return json({ error: "connection is not accepted yet" }, 403);
    const otherCompanyId = conn.company_a_id === actingCompanyId ? conn.company_b_id : conn.company_a_id;

    // Validate project access (owned or connected)
    const { data: project } = await admin
      .from("projects")
      .select("id, name, company_id, connection_code")
      .eq("id", body.project_id)
      .maybeSingle();
    if (!project) return json({ error: "project not found" }, 404);
    if (project.company_id !== actingCompanyId) {
      const { data: pc } = await admin
        .from("project_connections")
        .select("id")
        .eq("project_id", project.id)
        .eq("sub_company_id", actingCompanyId)
        .maybeSingle();
      if (!pc) return json({ error: "no access to this project" }, 403);
    }
    if (!project.connection_code) return json({ error: "project has no connection code" }, 400);

    const [{ data: senderCompany }, { data: otherCompany }] = await Promise.all([
      admin.from("companies").select("name").eq("id", actingCompanyId).maybeSingle(),
      admin.from("companies").select("name").eq("id", otherCompanyId).maybeSingle(),
    ]);

    const { data: tpl } = await admin
      .from("notification_templates")
      .select("subject, body_html")
      .eq("event_type", "project_connection_code_share")
      .eq("channel", "email")
      .eq("is_active", true)
      .maybeSingle();

    const senderName = escapeHtml(senderCompany?.name || "A contractor");
    const projectName = escapeHtml(project.name || "a project");
    const code = escapeHtml(project.connection_code);
    const safeMessage = customMessage ? escapeHtml(customMessage) : "";

    const defaultSubject = "{sender_company_name} shared a project connection code with you";
    const defaultBody = `
      <p>Hi {recipient_name},</p>
      <p><strong>{sender_company_name}</strong> shared the connection code for <strong>{project_name}</strong> on SSAA (Schedule Someone Anytime Anywhere).</p>
      <p style="font-size:20px;font-weight:bold;letter-spacing:2px;">{connection_code}</p>
      <p>Sign in to SSAA, open Manage My Company Account &rarr; Connected Contractors, and enter this code to link the project. Names, addresses and other project details stay unchanged on both sides.</p>
      {custom_message}
      <p><a href="https://ssaainc.com/">Open SSAA</a></p>
      <p>&mdash; The SSAA Team</p>
    `;

    const fill = (text: string, recipientName: string) =>
      text
        .replace(/\{recipient_name\}/g, escapeHtml(recipientName || "there"))
        .replace(/\{sender_company_name\}/g, senderName)
        .replace(/\{recipient_company_name\}/g, escapeHtml(otherCompany?.name || ""))
        .replace(/\{project_name\}/g, projectName)
        .replace(/\{connection_code\}/g, code)
        .replace(/\{custom_message\}/g, safeMessage ? `<p>${safeMessage}</p>` : "");

    const results: { email: string; ok: boolean; error?: string }[] = [];
    for (const r of recipients) {
      const subject = fill(tpl?.subject || defaultSubject, r.name).replace(/<[^>]*>/g, "");
      const html = fill(tpl?.body_html || defaultBody, r.name);
      let ok = false;
      let errMsg: string | undefined;
      try {
        const res = await resend.emails.send({
          from: "SSAA <notify@ssaainc.com>",
          to: [r.email],
          subject,
          html,
        });
        ok = !res.error;
        errMsg = res.error?.message;
      } catch (e) {
        errMsg = (e as Error).message;
      }
      results.push({ email: r.email, ok, error: errMsg });
      await admin.from("notification_log").insert({
        event_type: "project_connection_code_share",
        channel: "email",
        recipient_email: r.email,
        recipient_company_id: otherCompanyId,
        subject,
        status: ok ? "sent" : "failed",
        error_message: errMsg ?? null,
        metadata: { project_id: project.id, connection_id: conn.id, sender_company_id: actingCompanyId },
      });
    }

    return json({ ok: true, sent: results.filter((r) => r.ok).length, results });
  } catch (e) {
    console.error("send-project-connection-code error:", e);
    return json({ error: (e as Error).message }, 500);
  }
};

serve(handler);
