import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HELP_KEYWORDS = new Set(["HELP", "INFO", "SUPPORT"]);
const STOP_KEYWORDS = new Set(["STOP", "UNSUBSCRIBE", "END", "QUIT", "HALT"]);

function normalizePhone(phone: string): string {
  if (!phone) return "";
  const trimmed = phone.trim();
  if (trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
  const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
  const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const twiml = (msg?: string) =>
    new Response(
      msg
        ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${msg
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")}</Message></Response>`
        : `<?xml version="1.0" encoding="UTF-8"?><Response/>`,
      { status: 200, headers: { ...corsHeaders, "Content-Type": "text/xml" } }
    );

  try {
    let fromPhone = "";
    let toPhone = "";
    let body = "";
    let messageSid = "";

    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const raw = await req.text();
      const params = new URLSearchParams(raw);
      fromPhone = params.get("From") || "";
      toPhone = params.get("To") || "";
      body = params.get("Body") || "";
      messageSid = params.get("MessageSid") || "";
    } else if (contentType.includes("application/json")) {
      const j = await req.json();
      fromPhone = j.From || j.from || "";
      toPhone = j.To || j.to || "";
      body = j.Body || j.body || "";
      messageSid = j.MessageSid || j.messageSid || "";
    }

    const normalizedFrom = normalizePhone(fromPhone);
    const normalizedBody = (body || "").trim().toUpperCase();

    let matchedKeyword: string | null = null;
    let responseEventType: string | null = null;
    if (HELP_KEYWORDS.has(normalizedBody)) {
      matchedKeyword = normalizedBody;
      responseEventType = "sms_help_response";
    } else if (STOP_KEYWORDS.has(normalizedBody)) {
      matchedKeyword = normalizedBody;
      responseEventType = "sms_optout_response";
    }

    let responseStatus: string | null = null;
    let outboundSid: string | null = null;

    if (responseEventType) {
      // Suppress future messages if opt-out
      if (responseEventType === "sms_optout_response" && normalizedFrom) {
        await supabase
          .from("suppressed_phones")
          .upsert({ phone: normalizedFrom, reason: matchedKeyword });
      }

      // Load template
      const { data: template } = await supabase
        .from("notification_templates")
        .select("body_html,is_active")
        .eq("event_type", responseEventType)
        .eq("channel", "sms")
        .eq("is_active", true)
        .maybeSingle();

      const replyBody = template?.body_html || "";

      if (replyBody && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER && normalizedFrom) {
        try {
          const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
          const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
          const form = new URLSearchParams();
          form.append("To", normalizedFrom);
          form.append("From", TWILIO_PHONE_NUMBER);
          form.append("Body", replyBody);
          const r = await fetch(twilioUrl, {
            method: "POST",
            headers: {
              Authorization: `Basic ${auth}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: form.toString(),
          });
          const j = await r.json();
          if (r.ok) {
            responseStatus = "sent";
            outboundSid = j.sid || null;
          } else {
            responseStatus = "failed";
            console.error("Twilio reply failed:", j);
          }
        } catch (e) {
          responseStatus = "failed";
          console.error("Twilio reply error:", e);
        }
      } else if (!replyBody) {
        responseStatus = "no_template";
      }

      await supabase.from("notification_log").insert({
        event_type: responseEventType,
        channel: "sms",
        recipient_email: normalizedFrom,
        subject: null,
        status: responseStatus || "unknown",
        metadata: { auto_reply: true, twilio_sid: outboundSid, inbound_sid: messageSid },
      });
    }

    await supabase.from("sms_inbound_log").insert({
      from_phone: normalizedFrom || fromPhone,
      to_phone: toPhone,
      body,
      matched_keyword: matchedKeyword,
      response_event_type: responseEventType,
      response_status: responseStatus,
      twilio_message_sid: messageSid || null,
    });

    return twiml();
  } catch (err) {
    console.error("sms-inbound-webhook error:", err);
    return twiml();
  }
});
