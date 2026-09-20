import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type Action = "submitted" | "approved" | "denied";

interface RequestBody {
  requestId: string;
  action: Action;
}

function escapeHtml(unsafe: string): string {
  return String(unsafe ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isValidUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 255;
}

const EVENT_FOR_ACTION: Record<Action, string> = {
  submitted: "company_join_request_submitted",
  approved: "join_request_approved",
  denied: "join_request_denied",
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
    const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
    const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER");

    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase environment variables not configured");
    }

    const body = (await req.json()) as RequestBody;
    if (!body || typeof body.requestId !== "string" || !isValidUUID(body.requestId)) {
      return new Response(JSON.stringify({ error: "Invalid requestId" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    if (!body.action || !["submitted", "approved", "denied"].includes(body.action)) {
      return new Response(JSON.stringify({ error: "Invalid action" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const resend = new Resend(RESEND_API_KEY);

    // 1. Load the join request
    const { data: joinRequest, error: jrError } = await supabase
      .from("company_join_requests")
      .select("id, company_id, user_id, user_email, user_name")
      .eq("id", body.requestId)
      .single();

    if (jrError || !joinRequest) {
      console.error("Join request not found:", body.requestId, jrError);
      return new Response(JSON.stringify({ error: "Join request not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // 2. Load the company
    const { data: company } = await supabase
      .from("companies")
      .select("id, name")
      .eq("id", joinRequest.company_id)
      .single();

    const companyName = company?.name || "your company";

    // 3. Determine recipients (emails + phones) based on action
    let recipientEmails: string[] = [];
    let recipientPhones: string[] = [];

    if (body.action === "submitted") {
      // Notify all account holders of the company
      const { data: holderRoles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("company_id", joinRequest.company_id)
        .eq("permission_level", "account_holder");

      const holderUserIds = (holderRoles || []).map((r) => r.user_id);
      if (holderUserIds.length > 0) {
        const { data: holderProfiles } = await supabase
          .from("profiles")
          .select("email, phone")
          .in("user_id", holderUserIds);
        recipientEmails = (holderProfiles || [])
          .map((p) => p.email)
          .filter((e: any): e is string => !!e && isValidEmail(e));
        recipientPhones = (holderProfiles || [])
          .map((p) => p.phone)
          .filter((p: any): p is string => !!p);
      }
    } else {
      // approved/denied → notify the requester
      if (joinRequest.user_email && isValidEmail(joinRequest.user_email)) {
        recipientEmails = [joinRequest.user_email];
      }
      // Optionally pull phone from requester profile
      const { data: requesterProfile } = await supabase
        .from("profiles")
        .select("phone")
        .eq("user_id", joinRequest.user_id)
        .maybeSingle();
      if (requesterProfile?.phone) {
        recipientPhones = [requesterProfile.phone];
      }
    }

    if (recipientEmails.length === 0 && recipientPhones.length === 0) {
      console.log(`No recipients found for action=${body.action} request=${body.requestId}`);
      return new Response(
        JSON.stringify({ success: true, message: "No recipients" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    // 4. Build placeholder variables
    const variables: Record<string, string> = {
      company_name: companyName,
      requester_name: joinRequest.user_name || joinRequest.user_email || "A user",
      requester_email: joinRequest.user_email || "",
    };

    const eventType = EVENT_FOR_ACTION[body.action];

    // 5. Email send via templates
    const { data: emailTemplate } = await supabase
      .from("notification_templates")
      .select("subject, body_html")
      .eq("event_type", eventType)
      .eq("channel", "email")
      .eq("is_active", true)
      .maybeSingle();

    const emailResults: any[] = [];

    if (emailTemplate && recipientEmails.length > 0) {
      let subject = emailTemplate.subject;
      let bodyHtml = emailTemplate.body_html;
      for (const [key, value] of Object.entries(variables)) {
        const placeholder = `{${key}}`;
        const safeValue = escapeHtml(value);
        subject = subject.replaceAll(placeholder, safeValue);
        bodyHtml = bodyHtml.replaceAll(placeholder, safeValue);
      }

      const styledHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          ${bodyHtml}
          <p style="font-size: 12px; color: #aaa; margin-top: 24px; padding-top: 16px; border-top: 1px solid #eee;">
            — The SSAA Team
          </p>
        </div>
      `;

      const senderAddress = Deno.env.get("SENDER_EMAIL") || "SSAA <noreply@ssaainc.com>";

      for (const email of recipientEmails) {
        try {
          const sent = await resend.emails.send({
            from: senderAddress,
            to: [email],
            subject,
            html: styledHtml,
          });
          await supabase.from("notification_log").insert({
            event_type: eventType,
            channel: "email",
            recipient_email: email,
            recipient_company_id: joinRequest.company_id,
            subject,
            status: "sent",
            metadata: { resend_id: sent?.data?.id, variables, action: body.action },
          });
          emailResults.push({ email, success: true });
          console.log(`Sent ${eventType} email to ${email}`);
        } catch (err: any) {
          console.error(`Failed to send ${eventType} email to ${email}:`, err);
          await supabase.from("notification_log").insert({
            event_type: eventType,
            channel: "email",
            recipient_email: email,
            recipient_company_id: joinRequest.company_id,
            subject,
            status: "failed",
            error_message: err?.message || String(err),
            metadata: { variables, action: body.action },
          });
          emailResults.push({ email, success: false, error: err?.message });
        }
      }
    } else if (!emailTemplate) {
      console.log(`No active email template for ${eventType}; skipping email send.`);
    }

    // 6. SMS via Twilio (only if template exists & active and Twilio configured)
    const smsResults: any[] = [];
    if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER && recipientPhones.length > 0) {
      const { data: smsTemplate } = await supabase
        .from("notification_templates")
        .select("body_html")
        .eq("event_type", eventType)
        .eq("channel", "sms")
        .eq("is_active", true)
        .maybeSingle();

      if (smsTemplate) {
        // SMS is plain text; strip HTML tags from body_html and replace placeholders
        let smsBody = String(smsTemplate.body_html || "").replace(/<[^>]+>/g, "");
        for (const [key, value] of Object.entries(variables)) {
          smsBody = smsBody.replaceAll(`{${key}}`, value);
        }
        const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
        for (const phone of recipientPhones) {
          try {
            const formData = new URLSearchParams();
            formData.append("From", TWILIO_PHONE_NUMBER);
            formData.append("To", phone);
            formData.append("Body", smsBody);
            const twilioRes = await fetch(
              `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
              {
                method: "POST",
                headers: {
                  Authorization: `Basic ${auth}`,
                  "Content-Type": "application/x-www-form-urlencoded",
                },
                body: formData.toString(),
              },
            );
            const ok = twilioRes.ok;
            await supabase.from("notification_log").insert({
              event_type: eventType,
              channel: "sms",
              recipient_email: phone,
              recipient_company_id: joinRequest.company_id,
              subject: null,
              status: ok ? "sent" : "failed",
              error_message: ok ? null : await twilioRes.text(),
              metadata: { variables, action: body.action },
            });
            smsResults.push({ phone, success: ok });
          } catch (err: any) {
            console.error(`Failed to send ${eventType} SMS to ${phone}:`, err);
            smsResults.push({ phone, success: false, error: err?.message });
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, action: body.action, emailResults, smsResults }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  } catch (error: any) {
    console.error("Error in notify-join-request:", error);
    return new Response(
      JSON.stringify({ success: false, error: error?.message || String(error) }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }
};

serve(handler);
