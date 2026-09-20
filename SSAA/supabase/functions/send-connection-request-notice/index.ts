import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const escapeHtml = (u: string) =>
  u.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
const fill = (text: string, vars: Record<string, string>) => {
  let out = text;
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, escapeHtml(String(v ?? "")));
  return out;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

interface Body {
  mode: "request" | "declined";
  connection_id: string;
  acting_company_id?: string | null;
  recipient_user_ids?: string[];
  sender_user_id?: string | null;
}

serve(async (req: Request) => {
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
    const body = (await req.json()) as Body;

    const mode = body.mode === "declined" ? "declined" : "request";
    if (!isUuid(body.connection_id)) return json({ error: "invalid connection_id" }, 400);

    const [{ data: callerProfile }, { data: operatorRow }] = await Promise.all([
      admin.from("profiles").select("company_id, full_name, email").eq("user_id", userData.user.id).maybeSingle(),
      admin.from("operators").select("id").eq("user_id", userData.user.id).maybeSingle(),
    ]);
    const { data: callerRole } = await admin.from("profiles").select("role").eq("user_id", userData.user.id).maybeSingle();
    const isOperator = !!operatorRow || callerRole?.role === "moa";

    let actingCompanyId: string | null = callerProfile?.company_id ?? null;
    if (isOperator && isUuid(body.acting_company_id)) actingCompanyId = body.acting_company_id as string;
    if (!actingCompanyId) return json({ error: "no company" }, 400);

    const { data: connection } = await admin
      .from("contractor_connections")
      .select("id, company_a_id, company_b_id, initiated_by_company_id, initiated_by_user_id")
      .eq("id", body.connection_id)
      .maybeSingle();
    if (!connection) return json({ error: "connection not found" }, 404);
    if (connection.company_a_id !== actingCompanyId && connection.company_b_id !== actingCompanyId) {
      return json({ error: "not on this connection" }, 403);
    }

    const otherCompanyId = connection.company_a_id === actingCompanyId ? connection.company_b_id : connection.company_a_id;
    const { data: companies } = await admin.from("companies").select("id, name").in("id", [actingCompanyId, otherCompanyId]);
    const nameOf = (id: string) => (companies || []).find((c: any) => c.id === id)?.name || "A contractor";

    // Resolve the recipients for this mode.
    let recipientIds: string[] = [];
    let targetCompanyId: string;
    if (mode === "request") {
      recipientIds = [...new Set((body.recipient_user_ids || []).filter(isUuid))];
      if (recipientIds.length === 0) return json({ error: "at least one recipient is required" }, 400);
      if (recipientIds.length > 50) return json({ error: "too many recipients" }, 400);
      targetCompanyId = otherCompanyId;
    } else {
      if (!connection.initiated_by_user_id) return json({ error: "no requester to notify" }, 400);
      recipientIds = [connection.initiated_by_user_id as string];
      targetCompanyId = connection.initiated_by_company_id;
    }

    const { data: recipientProfiles } = await admin
      .from("profiles")
      .select("user_id, full_name, email, company_id")
      .in("user_id", recipientIds);
    const validRecipients = (recipientProfiles || []).filter((p: any) => p.company_id === targetCompanyId);
    if (validRecipients.length === 0) return json({ error: "no valid recipients" }, 400);

    const eventType = mode === "request" ? "contractor_connection_request" : "contractor_connection_declined";

    const { data: emailTemplate } = await admin
      .from("notification_templates")
      .select("subject, body_html")
      .eq("event_type", eventType)
      .eq("channel", "email")
      .eq("is_active", true)
      .maybeSingle();

    const signInUrl = "https://ssaainc.com/";
    const baseVars: Record<string, string> =
      mode === "request"
        ? {
            inviting_company_name: nameOf(actingCompanyId),
            invited_company_name: nameOf(otherCompanyId),
            sign_in_url: signInUrl,
          }
        : {
            inviting_company_name: nameOf(targetCompanyId),
            declining_company_name: nameOf(actingCompanyId),
            decliner_name: callerProfile?.full_name || "A contractor",
            sign_in_url: signInUrl,
          };

    const results: unknown[] = [];
    // No active template for this event means the email is turned off — send nothing.
    const emailSkipped = !emailTemplate;
    for (const recipient of validRecipients) {
      const vars = { ...baseVars, recipient_name: recipient.full_name || "there" };
      if (emailTemplate && recipient.email) {
        try {
          const res = await resend.emails.send({
            from: "SSAA <notify@ssaainc.com>",
            to: [recipient.email],
            subject: fill(emailTemplate.subject, vars),
            html: fill(emailTemplate.body_html, vars),
          });
          results.push({ user_id: recipient.user_id, email: !res.error, error: res.error?.message });
        } catch (e) {
          results.push({ user_id: recipient.user_id, email: false, error: (e as Error).message });
        }
      }
    }

    // Push notification, bell entry and People message, attributed to the acting person.
    const pushPayload: Record<string, unknown> = {
      event_type: eventType,
      recipient_user_ids: validRecipients.map((r: any) => r.user_id),
      variables: baseVars,
    };
    if (isUuid(body.sender_user_id)) pushPayload.sender_user_id = body.sender_user_id;

    const pushResponse = await fetch(`${supabaseUrl}/functions/v1/send-push`, {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json", apikey: anonKey },
      body: JSON.stringify(pushPayload),
    });
    const pushResult = await pushResponse.json().catch(() => ({}));

    return json({ ok: true, email_skipped: emailSkipped, results, push: pushResult });
  } catch (e) {
    console.error("send-connection-request-notice error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
