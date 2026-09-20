import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface NotificationRequest {
  event_type: string;
  recipient_emails: string[];
  recipient_company_id?: string;
  /** Optional project id. When provided together with recipient_company_id,
   * {project_name} / {project_address} placeholders are resolved from the
   * recipient company's alias (falling back to the canonical projects row).
   */
  project_id?: string;
  variables: Record<string, string>;
}

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 255;
}

function isValidUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is not configured");
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

    const resend = new Resend(RESEND_API_KEY);
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { event_type, recipient_emails, recipient_company_id, project_id, variables }: NotificationRequest = await req.json();

    // Input validation
    if (!event_type || typeof event_type !== "string" || event_type.length > 100) {
      throw new Error("Invalid event_type");
    }
    if (project_id && !isValidUUID(project_id)) {
      throw new Error("Invalid project_id format");
    }
    if (!recipient_emails || !Array.isArray(recipient_emails) || recipient_emails.length === 0) {
      throw new Error("Missing required field: recipient_emails");
    }
    if (recipient_emails.length > 100) {
      throw new Error("recipient_emails exceeds maximum of 100");
    }
    for (const email of recipient_emails) {
      if (!isValidEmail(email)) {
        throw new Error(`Invalid email address: ${email}`);
      }
    }
    if (recipient_company_id && !isValidUUID(recipient_company_id)) {
      throw new Error("Invalid recipient_company_id format");
    }
    if (variables && typeof variables !== "object") {
      throw new Error("variables must be an object");
    }

    // Look up the template for this event type
    const { data: template, error: templateError } = await supabase
      .from("notification_templates")
      .select("*")
      .eq("event_type", event_type)
      .eq("channel", "email")
      .eq("is_active", true)
      .single();

    if (templateError || !template) {
      console.log(`No active template found for event_type: ${event_type}`);
      return new Response(JSON.stringify({ success: true, message: "No active template found, email not sent" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Resolve per-recipient-company project name/address override using project_aliases.
    // This guarantees the recipient sees the project name they themselves use,
    // regardless of how the sender refers to it locally.
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

    // Replace placeholder variables in subject and body, with HTML escaping
    let subject = template.subject;
    let bodyHtml = template.body_html;

    for (const [key, value] of Object.entries(resolvedVariables)) {
      const placeholder = `{${key}}`;
      const safeValue = escapeHtml(String(value || ""));
      subject = subject.replaceAll(placeholder, safeValue);
      bodyHtml = bodyHtml.replaceAll(placeholder, safeValue);
    }

    // Wrap body in a styled container
    const styledHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        ${bodyHtml}
        <p style="font-size: 12px; color: #aaa; margin-top: 24px; padding-top: 16px; border-top: 1px solid #eee;">
          — The SSAA Team
        </p>
      </div>
    `;

    const results = [];

    for (const email of recipient_emails) {
      try {
        const senderAddress = Deno.env.get("SENDER_EMAIL") || "SSAA <noreply@ssaainc.com>";
        const emailResponse = await resend.emails.send({
          from: senderAddress,
          to: [email],
          subject,
          html: styledHtml,
        });

        await supabase.from("notification_log").insert({
          event_type,
          channel: "email",
          recipient_email: email,
          recipient_company_id: recipient_company_id || null,
          subject,
          status: "sent",
          metadata: { resend_id: emailResponse?.data?.id, variables },
        });

        results.push({ email, success: true, id: emailResponse?.data?.id });
        console.log(`Email sent to ${email} for event ${event_type}`);
      } catch (emailError: any) {
        console.error(`Failed to send email to ${email}:`, emailError);

        await supabase.from("notification_log").insert({
          event_type,
          channel: "email",
          recipient_email: email,
          recipient_company_id: recipient_company_id || null,
          subject,
          status: "failed",
          error_message: emailError.message,
          metadata: { variables },
        });

        results.push({ email, success: false, error: emailError.message });
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error in send-notification function:", error);
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
