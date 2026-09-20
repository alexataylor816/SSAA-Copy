import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing environment variables");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { email, code, new_password } = await req.json();

    if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid or expired code. Please request a new one." }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (!code || typeof code !== "string" || !/^\d{6}$/.test(code)) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid or expired code. Please request a new one." }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (!new_password || typeof new_password !== "string" || new_password.length < 6 || new_password.length > 72) {
      return new Response(
        JSON.stringify({ success: false, error: "Password must be between 6 and 72 characters" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Rate limit: check total verification requests for this email in last 15 minutes
    const { count: totalAttempts } = await supabase
      .from("password_reset_codes")
      .select("id", { count: "exact", head: true })
      .eq("email", email.toLowerCase().trim())
      .gte("created_at", new Date(Date.now() - 15 * 60 * 1000).toISOString());

    if (totalAttempts && totalAttempts >= 10) {
      console.log(`Rate limit exceeded for verify-reset-code: ${email}`);
      return new Response(
        JSON.stringify({ success: false, error: "Too many attempts. Please try again later." }),
        { status: 429, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Look up the most recent unused, unexpired code for this email
    const { data: resetCode, error: lookupError } = await supabase
      .from("password_reset_codes")
      .select("*")
      .eq("email", email.toLowerCase().trim())
      .eq("used", false)
      .gte("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!resetCode) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid or expired code. Please request a new one." }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Check if this code has been brute-forced (3 failed attempts invalidates it)
    if (resetCode.failed_attempts >= 3) {
      await supabase
        .from("password_reset_codes")
        .update({ used: true })
        .eq("id", resetCode.id);
      return new Response(
        JSON.stringify({ success: false, error: "Invalid or expired code. Please request a new one." }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Verify the code matches
    if (resetCode.code !== code) {
      // Increment failed_attempts on the code
      await supabase
        .from("password_reset_codes")
        .update({ failed_attempts: (resetCode.failed_attempts || 0) + 1 })
        .eq("id", resetCode.id);
      return new Response(
        JSON.stringify({ success: false, error: "Invalid or expired code. Please request a new one." }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Code is valid — mark as used
    await supabase
      .from("password_reset_codes")
      .update({ used: true })
      .eq("id", resetCode.id);

    // Find user by email in profiles
    const { data: profile } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("email", email.toLowerCase().trim())
      .single();

    if (!profile) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid or expired code. Please request a new one." }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Update password via admin API
    const { error: updateError } = await supabase.auth.admin.updateUserById(
      profile.user_id,
      { password: new_password }
    );

    if (updateError) {
      console.error("Failed to update password:", updateError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to update password. Please try again." }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`Password reset successful for ${email}`);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error in verify-reset-code:", error);
    return new Response(
      JSON.stringify({ success: false, error: "An unexpected error occurred. Please try again." }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
