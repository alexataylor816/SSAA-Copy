import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (phone.startsWith('+')) return phone;
  return `+${digits}`;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!RESEND_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing environment variables");
    }

    const resend = new Resend(RESEND_API_KEY);
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = await req.json();
    const { email, channel, admin_reset, new_password } = body;

    if (!email) {
      throw new Error("Email is required");
    }

    // Handle admin_reset (MO/OMO direct password change)
    if (admin_reset && new_password) {
      const normalizedEmail = email.toLowerCase().trim();
      console.log(`[admin_reset] Looking up user with email: ${normalizedEmail}`);

      // Try profiles table first (case-insensitive)
      let targetUserId: string | null = null;
      const { data: profileRows, error: profileLookupErr } = await supabase
        .from("profiles")
        .select("user_id, email")
        .ilike("email", normalizedEmail);

      if (profileLookupErr) {
        console.error(`[admin_reset] Profile lookup error:`, profileLookupErr);
      }

      if (profileRows && profileRows.length > 0) {
        targetUserId = profileRows[0].user_id;
        console.log(`[admin_reset] Found via profiles: ${targetUserId} (matched ${profileRows.length} row(s))`);
      } else {
        // Fallback: search auth.users directly via admin API
        console.log(`[admin_reset] No profile match, searching auth.users...`);
        const { data: authList, error: authListErr } = await supabase.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        });
        if (authListErr) {
          console.error(`[admin_reset] auth.admin.listUsers error:`, authListErr);
        }
        const matched = authList?.users?.find(
          (u) => (u.email || "").toLowerCase().trim() === normalizedEmail
        );
        if (matched) {
          targetUserId = matched.id;
          console.log(`[admin_reset] Found via auth.users: ${targetUserId}`);
        }
      }

      if (!targetUserId) {
        console.error(`[admin_reset] No user found for email: ${normalizedEmail}`);
        return new Response(
          JSON.stringify({ success: false, error: `No user account found for ${email}` }),
          {
            status: 200,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          }
        );
      }

      const { data: updateData, error: updateError } = await supabase.auth.admin.updateUserById(
        targetUserId,
        { password: new_password }
      );

      if (updateError) {
        console.error(`[admin_reset] updateUserById failed for ${targetUserId}:`, updateError);
        return new Response(
          JSON.stringify({
            success: false,
            error: `Failed to update password: ${updateError.message}`,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          }
        );
      }

      // Also clear force_password_change so the user is not blocked on next login
      await supabase
        .from("profiles")
        .update({ force_password_change: false })
        .eq("user_id", targetUserId);

      console.log(`[admin_reset] Password successfully updated for ${normalizedEmail} (user_id=${targetUserId})`);
      return new Response(
        JSON.stringify({ success: true, user_id: targetUserId, email: normalizedEmail }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    // Check if user exists
    const { data: profile } = await supabase
      .from("profiles")
      .select("user_id, phone")
      .eq("email", email.toLowerCase().trim())
      .single();

    if (!profile) {
      // Don't reveal if email exists - return success silently
      console.log(`No profile found for email: ${email}`);
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Rate limit: max 5 reset requests per email per 15 minutes
    const { data: recentCodes, error: rateError } = await supabase
      .from("password_reset_codes")
      .select("created_at")
      .eq("email", email.toLowerCase().trim())
      .gte("created_at", new Date(Date.now() - 15 * 60 * 1000).toISOString());

    if (!rateError && recentCodes && recentCodes.length >= 5) {
      console.log(`Rate limit exceeded for email: ${email}`);
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Generate a random 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000));

    // Invalidate any existing unused codes for this email
    await supabase
      .from("password_reset_codes")
      .update({ used: true })
      .eq("email", email.toLowerCase().trim())
      .eq("used", false);

    // Store the new code
    const { error: insertError } = await supabase
      .from("password_reset_codes")
      .insert({
        email: email.toLowerCase().trim(),
        code,
      });

    if (insertError) {
      console.error("Failed to store reset code:", insertError);
      throw new Error("Failed to generate reset code");
    }

    const selectedChannel = channel || "email";

    // SMS channel
    if (selectedChannel === "sms") {
      const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
      const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
      const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER");

      if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
        throw new Error("SMS is not configured");
      }

      const userPhone = profile.phone;
      if (!userPhone || userPhone.replace(/\D/g, '').length < 10) {
        throw new Error("No valid phone number on file");
      }

      // Check for SMS template
      const { data: smsTemplate } = await supabase
        .from("notification_templates")
        .select("*")
        .eq("event_type", "password_reset")
        .eq("channel", "sms")
        .eq("is_active", true)
        .single();

      let smsBody = `Your SSAA verification code is: ${code}. This code expires in 15 minutes.`;
      if (smsTemplate) {
        smsBody = smsTemplate.body_html
          .replaceAll("{code}", code)
          .replaceAll("{email}", email);
      }

      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
      const authHeaderTwilio = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
      const normalizedPhone = normalizePhone(userPhone);

      const formData = new URLSearchParams();
      formData.append("To", normalizedPhone);
      formData.append("From", TWILIO_PHONE_NUMBER);
      formData.append("Body", smsBody);

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
        console.error(`Twilio error for ${email}:`, twilioData);
        await supabase.from("notification_log").insert({
          event_type: "password_reset",
          channel: "sms",
          recipient_email: email,
          status: "failed",
          error_message: twilioData.message || `Twilio error: ${twilioResponse.status}`,
        });
        throw new Error("Failed to send verification code via text");
      }

      await supabase.from("notification_log").insert({
        event_type: "password_reset",
        channel: "sms",
        recipient_email: email,
        status: "sent",
        metadata: { twilio_sid: twilioData.sid },
      });

      console.log(`Password reset code sent via SMS to ${email}`);
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Email channel (default)
    // Look up the email template
    const { data: template } = await supabase
      .from("notification_templates")
      .select("*")
      .eq("event_type", "password_reset")
      .eq("channel", "email")
      .eq("is_active", true)
      .single();

    let subject = "Your Password Reset Code";
    let bodyHtml = `Hi,\n\nYour password reset verification code is: ${code}\n\nThis code expires in 15 minutes. If you did not request a password reset, please ignore this email.`;

    if (template) {
      subject = template.subject;
      bodyHtml = template.body_html;
      subject = subject.replaceAll("{code}", code);
      subject = subject.replaceAll("{email}", email);
      bodyHtml = bodyHtml.replaceAll("{code}", code);
      bodyHtml = bodyHtml.replaceAll("{email}", email);
    }

    // Wrap in styled container
    const styledHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        ${bodyHtml.replace(/\n/g, "<br/>")}
        <p style="font-size: 12px; color: #aaa; margin-top: 24px; padding-top: 16px; border-top: 1px solid #eee;">
          — The SSAA Team
        </p>
      </div>
    `;

    const senderAddress = Deno.env.get("SENDER_EMAIL") || "SSAA <noreply@ssaainc.com>";

    try {
      await resend.emails.send({
        from: senderAddress,
        to: [email],
        subject,
        html: styledHtml,
      });

      await supabase.from("notification_log").insert({
        event_type: "password_reset",
        channel: "email",
        recipient_email: email,
        subject,
        status: "sent",
        metadata: { variables: { email } },
      });

      console.log(`Password reset code sent to ${email}`);
    } catch (emailError: any) {
      console.error(`Failed to send email to ${email}:`, emailError);
      await supabase.from("notification_log").insert({
        event_type: "password_reset",
        channel: "email",
        recipient_email: email,
        subject,
        status: "failed",
        error_message: emailError.message,
      });
      throw new Error("Failed to send reset email");
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error in request-password-reset:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
