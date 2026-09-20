import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface SmsRequest {
  event_type: string;
  recipient_phones: string[];
  recipient_company_id?: string;
  project_id?: string;
  variables: Record<string, string>;
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (phone.startsWith('+')) return phone;
  return `+${digits}`;
}

function isValidPhoneDigits(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

function isValidUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
    const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
    const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER");

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
      throw new Error("Twilio environment variables not configured");
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase environment variables not configured");
    }

    // Authenticate the caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const supabaseAuth = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { event_type, recipient_phones, recipient_company_id, project_id, variables }: SmsRequest = await req.json();

    // Input validation
    if (!event_type || typeof event_type !== "string" || event_type.length > 100) {
      throw new Error("Invalid event_type");
    }
    if (!recipient_phones || !Array.isArray(recipient_phones) || recipient_phones.length === 0) {
      throw new Error("Missing required field: recipient_phones");
    }
    if (recipient_phones.length > 100) {
      throw new Error("recipient_phones exceeds maximum of 100");
    }
    for (const phone of recipient_phones) {
      if (!isValidPhoneDigits(phone)) {
        throw new Error(`Invalid phone number: ${phone}`);
      }
    }
    if (recipient_company_id && !isValidUUID(recipient_company_id)) {
      throw new Error("Invalid recipient_company_id format");
    }
    if (variables && typeof variables !== "object") {
      throw new Error("variables must be an object");
    }

    // Look up the SMS template for this event type
    const { data: template, error: templateError } = await supabase
      .from("notification_templates")
      .select("*")
      .eq("event_type", event_type)
      .eq("channel", "sms")
      .eq("is_active", true)
      .single();

    if (templateError || !template) {
      console.log(`No active SMS template found for event_type: ${event_type}`);
      return new Response(JSON.stringify({ success: true, message: "No active SMS template found, SMS not sent" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Per-recipient-company alias override for project_name / project_address
    let resolvedVariables = { ...(variables || {}) };
    if (project_id && recipient_company_id) {
      try {
        const { data: resolved } = await supabase.rpc("resolve_project_display", {
          p_project_id: project_id,
          p_company_id: recipient_company_id,
        });
        const row = Array.isArray(resolved) ? resolved[0] : resolved;
        if (row?.name) resolvedVariables.project_name = row.name;
        if (row?.address) resolvedVariables.project_address = row.address;
      } catch (resolveErr) {
        console.error("resolve_project_display failed:", resolveErr);
      }
    }

    // Replace placeholder variables in body
    let body = template.body_html;
    for (const [key, value] of Object.entries(resolvedVariables)) {
      const placeholder = `{${key}}`;
      body = body.replaceAll(placeholder, String(value || ""));
    }

    // Limit SMS body length
    if (body.length > 1600) {
      body = body.substring(0, 1597) + "...";
    }

    const results = [];

    // Load suppressed phones (opted-out numbers). Welcome / opt-out reply bypass.
    const bypassSuppression = event_type === 'sms_optout_response' || event_type === 'sms_welcome_confirmation';
    let suppressedSet = new Set<string>();
    if (!bypassSuppression) {
      const { data: suppressed } = await supabase.from('suppressed_phones').select('phone');
      suppressedSet = new Set((suppressed || []).map((r: any) => r.phone));
    }

    for (const phone of recipient_phones) {
      const normalizedPhone = normalizePhone(phone);
      if (suppressedSet.has(normalizedPhone)) {
        console.log(`Skipping suppressed phone ${normalizedPhone}`);
        results.push({ phone, success: false, error: 'suppressed' });
        continue;
      }
      try {
        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
        const authHeaderTwilio = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

        const formData = new URLSearchParams();
        formData.append("To", normalizedPhone);
        formData.append("From", TWILIO_PHONE_NUMBER);
        formData.append("Body", body);

        const twilioResponse = await fetch(twilioUrl, {
          method: "POST",
          headers: {
            "Authorization": `Basic ${authHeaderTwilio}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: formData.toString(),
        });

        const twilioData = await twilioResponse.json();

        if (!twilioResponse.ok) {
          throw new Error(twilioData.message || `Twilio error: ${twilioResponse.status}`);
        }

        await supabase.from("notification_log").insert({
          event_type,
          channel: "sms",
          recipient_email: phone,
          recipient_company_id: recipient_company_id || null,
          subject: null,
          status: "sent",
          metadata: { twilio_sid: twilioData.sid, variables },
        });

        results.push({ phone, success: true, sid: twilioData.sid });
        console.log(`SMS sent to ${phone} for event ${event_type}`);
      } catch (smsError: any) {
        console.error(`Failed to send SMS to ${phone}:`, smsError);

        await supabase.from("notification_log").insert({
          event_type,
          channel: "sms",
          recipient_email: phone,
          recipient_company_id: recipient_company_id || null,
          subject: null,
          status: "failed",
          error_message: smsError.message,
          metadata: { variables },
        });

        results.push({ phone, success: false, error: smsError.message });
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error in send-sms function:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
