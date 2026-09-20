import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 255;
}

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

interface ProjectInviteRequest {
  recipientEmail: string;
  projectName: string;
  connectionCode: string;
  senderCompanyName: string;
  isSubToGCInvite?: boolean;
  inviteUrl?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: ProjectInviteRequest = await req.json();
    const { recipientEmail, projectName, connectionCode, senderCompanyName, isSubToGCInvite, inviteUrl } = body;

    // Input validation
    if (!recipientEmail || !isValidEmail(recipientEmail)) {
      throw new Error("Invalid or missing recipientEmail");
    }
    if (senderCompanyName && (typeof senderCompanyName !== "string" || senderCompanyName.length > 255)) {
      throw new Error("senderCompanyName too long (max 255 chars)");
    }
    if (connectionCode && (typeof connectionCode !== "string" || connectionCode.length > 50)) {
      throw new Error("connectionCode too long (max 50 chars)");
    }
    if (projectName && (typeof projectName !== "string" || projectName.length > 255)) {
      throw new Error("projectName too long (max 255 chars)");
    }
    if (inviteUrl && (typeof inviteUrl !== "string" || inviteUrl.length > 2000)) {
      throw new Error("inviteUrl too long (max 2000 chars)");
    }

    console.log(`Sending ${isSubToGCInvite ? 'GC invite' : 'project invite'} to ${recipientEmail}`);

    const safeSenderCompanyName = escapeHtml(senderCompanyName || '');
    const safeProjectName = escapeHtml(projectName || '');
    const safeConnectionCode = escapeHtml(connectionCode || '');

    let emailSubject: string;
    let emailHtml: string;
    let recipientIsExistingUser = false;

    if (isSubToGCInvite) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      // Detect existing SSAA account
      const normalizedEmail = recipientEmail.trim().toLowerCase();
      try {
        const { data: usersList } = await supabase.auth.admin.listUsers();
        recipientIsExistingUser = !!usersList?.users?.find(
          (u: any) => u.email?.toLowerCase() === normalizedEmail
        );
      } catch (lookupErr) {
        console.error("Existing-user lookup failed (treating as new user):", lookupErr);
      }

      if (recipientIsExistingUser) {
        // Welcome back: short email pointing to connection code + sign-in
        emailSubject = `${senderCompanyName || 'A subcontractor'} wants to connect with you on SSAA`;
        emailHtml = `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #1e3a5f; margin-bottom: 24px;">Welcome back to SSAA</h1>

            <p style="font-size: 16px; color: #333; line-height: 1.6;">
              <strong>${safeSenderCompanyName || 'A subcontractor'}</strong> wants to connect with you on SSAA for scheduling coordination${projectName ? ` on <strong>${safeProjectName}</strong>` : ''}.
            </p>

            <p style="font-size: 16px; color: #333; line-height: 1.6;">
              Since you already have an SSAA account, just sign in and enter the connection code below on your dashboard — no new account needed.
            </p>

            <div style="background-color: #f4f4f4; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center;">
              <p style="margin: 0 0 8px 0; color: #666; font-size: 14px;">Your Connection Code:</p>
              <p style="font-size: 32px; font-weight: bold; color: #1e3a5f; letter-spacing: 4px; margin: 0; font-family: monospace;">
                ${safeConnectionCode || 'N/A'}
              </p>
            </div>

            <div style="text-align: center; margin: 32px 0;">
              <a href="https://ssaainc.com/" style="background-color: #1e3a5f; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: bold; display: inline-block;">Sign In</a>
            </div>

            <h3 style="color: #1e3a5f;">How to connect:</h3>
            <ol style="color: #333; line-height: 1.8;">
              <li>Sign in to your SSAA dashboard</li>
              <li>Click "Connect to Project"</li>
              <li>Enter the connection code above</li>
              <li>You'll be connected and can start coordinating schedules</li>
            </ol>

            <p style="font-size: 14px; color: #888; margin-top: 32px; padding-top: 16px; border-top: 1px solid #eee;">
              If you didn't expect this invitation, you can safely ignore this email.
            </p>

            <p style="font-size: 12px; color: #aaa; margin-top: 24px;">— The SSAA Team</p>
          </div>
        `;
      } else {
        const { data: template } = await supabase
          .from('notification_templates')
          .select('subject, body_html')
          .eq('event_type', 'gc_invite_to_ssaa')
          .eq('is_active', true)
          .single();

        if (template) {
          emailSubject = template.subject
            .replace(/\{sub_company_name\}/g, safeSenderCompanyName || 'A Subcontractor');
          emailHtml = template.body_html
            .replace(/\{sub_company_name\}/g, safeSenderCompanyName || 'A Subcontractor')
            .replace(/\{invite_url\}/g, inviteUrl || '#')
            .replace(/\{connection_code\}/g, safeConnectionCode || 'N/A');
        } else {
          emailSubject = `Join SSAA Network - Invitation from ${safeSenderCompanyName || 'A Subcontractor'}`;
          emailHtml = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h1 style="color: #1e3a5f; margin-bottom: 24px;">You've Been Invited to SSAA!</h1>
              <p style="font-size: 16px; color: #333; line-height: 1.6;">
                <strong>${safeSenderCompanyName || 'A Subcontractor'}</strong> has invited you to join the SSAA Network to coordinate scheduling.
              </p>
              <div style="background-color: #e8f5e9; border-radius: 8px; padding: 20px; margin: 24px 0; border: 2px solid #2e7d32;">
                <h3 style="color: #2e7d32; margin-top: 0;">⭐ Option 1: Full Company Account (Recommended)</h3>
                <ul style="color: #333; line-height: 1.8; margin: 0; padding-left: 20px;">
                  <li>See <strong>all your subcontractors</strong> across all your projects in one place</li>
                  <li>Schedule multiple subs simultaneously from a single dashboard</li>
                  <li>Project info saved once — no re-entry for every request</li>
                  <li>Full access to scheduling, availability, task management, and team tools</li>
                  <li>Best long-term experience for managing your construction projects</li>
                </ul>
              </div>
              <div style="background-color: #fff3e0; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <h3 style="color: #e65100; margin-top: 0;">Option 2: Guest Account (Quick &amp; Free)</h3>
                <ul style="color: #333; line-height: 1.8; margin: 0; padding-left: 20px;">
                  <li>Free to use — no subscription required</li>
                  <li><strong>You can still connect to multiple subcontractors</strong> from one Guest Account using their connection codes</li>
                  <li>Must input your project information with each schedule request</li>
                  <li>Great for getting started quickly — you can upgrade to a Full Account anytime</li>
                </ul>
              </div>
              ${inviteUrl ? `
              <div style="text-align: center; margin: 32px 0;">
                <a href="${inviteUrl}" style="background-color: #1e3a5f; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: bold; display: inline-block;">Get Started</a>
                <p style="margin: 12px 0 0 0; font-size: 13px; color: #666;">
                  For the fastest setup, click the button above — your project and connection to the subcontractor will be created automatically.
                </p>
                <p style="margin: 16px 0 0 0; font-size: 13px; color: #666;">
                  Already have an SSAA account? <a href="https://ssaainc.com/" style="color: #1e3a5f; font-weight: bold; text-decoration: underline;">Sign in here</a>.
                </p>
              </div>
              ` : ''}
              <div style="background-color: #f4f4f4; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center;">
                <p style="margin: 0 0 8px 0; color: #666; font-size: 14px;">Or use this Connection Code after creating your account:</p>
                <p style="font-size: 28px; font-weight: bold; color: #1e3a5f; letter-spacing: 4px; margin: 0; font-family: monospace;">
                  ${safeConnectionCode}
                </p>
              </div>
              <p style="font-size: 14px; color: #888; margin-top: 32px; padding-top: 16px; border-top: 1px solid #eee;">
                If you didn't expect this invitation, you can safely ignore this email.
              </p>
              <p style="font-size: 12px; color: #aaa; margin-top: 24px;">— The SSAA Team</p>
            </div>
          `;
        }
      }
    } else {
      if (!projectName || !connectionCode) {
        throw new Error("Missing required fields: projectName or connectionCode");
      }
      emailSubject = `You've been invited to join ${safeProjectName}`;
      emailHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #1e3a5f; margin-bottom: 24px;">Project Invitation</h1>
          <p style="font-size: 16px; color: #333; line-height: 1.6;">
            You've been invited by <strong>${safeSenderCompanyName || 'a company'}</strong> to connect to the project <strong>${safeProjectName}</strong> on SSAA.
          </p>
          <div style="background-color: #f4f4f4; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center;">
            <p style="margin: 0 0 8px 0; color: #666; font-size: 14px;">Your Connection Code:</p>
            <p style="font-size: 32px; font-weight: bold; color: #1e3a5f; letter-spacing: 4px; margin: 0; font-family: monospace;">
              ${safeConnectionCode}
            </p>
          </div>
          <h3 style="color: #1e3a5f;">How to connect:</h3>
          <ol style="color: #333; line-height: 1.8;">
            <li>Log in to your SSAA dashboard</li>
            <li>Click the "Connect to Project" button</li>
            <li>Enter the connection code above</li>
            <li>You'll be connected and can start coordinating schedules!</li>
          </ol>
          <p style="font-size: 14px; color: #888; margin-top: 32px; padding-top: 16px; border-top: 1px solid #eee;">
            If you didn't expect this invitation, you can safely ignore this email.
          </p>
          <p style="font-size: 12px; color: #aaa; margin-top: 24px;">— The SSAA Team</p>
        </div>
      `;
    }

    const senderEmail = Deno.env.get("SENDER_EMAIL") || "SSAA <noreply@ssaainc.com>";

    const emailResponse = await resend.emails.send({
      from: senderEmail,
      to: [recipientEmail],
      subject: emailSubject,
      html: emailHtml,
    });

    if ((emailResponse as any)?.error) {
      const errMsg = (emailResponse as any).error?.message || "Email provider rejected the request";
      console.error("Resend rejected email:", emailResponse);
      return new Response(
        JSON.stringify({ success: false, error: errMsg, recipientIsExistingUser }),
        {
          status: 422,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    console.log("Project invite email sent successfully:", emailResponse);

    return new Response(
      JSON.stringify({ success: true, data: emailResponse, recipientIsExistingUser }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Error sending project invite:", error);
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
