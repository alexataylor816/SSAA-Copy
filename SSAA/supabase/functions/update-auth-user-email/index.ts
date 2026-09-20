import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 255;
}

function isValidUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    // Extract bearer token
    const token = authHeader.replace(/^Bearer\s+/i, "");

    // Check if it's the service role key (from DB triggers / internal calls)
    const isServiceRole = token === serviceRoleKey;

    if (!isServiceRole) {
      // Verify caller is MOA using their JWT
      const callerClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });

      const { data: { user: callerUser }, error: authError } = await callerClient.auth.getUser();
      if (authError || !callerUser) {
        throw new Error("Unauthorized: invalid token");
      }

      const { data: profile } = await callerClient
        .from("profiles")
        .select("role")
        .eq("user_id", callerUser.id)
        .single();

      if (!profile || profile.role !== "moa") {
        throw new Error("Unauthorized: MOA access required");
      }
    }

    const { user_id, new_email } = await req.json();
    if (!user_id || !isValidUUID(user_id)) {
      throw new Error("Missing or invalid user_id");
    }
    if (!new_email || !isValidEmail(new_email)) {
      throw new Error("Missing or invalid new_email");
    }

    const normalizedEmail = new_email.trim().toLowerCase();

    // Use service role to update auth user email
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { error } = await adminClient.auth.admin.updateUserById(user_id, {
      email: normalizedEmail,
      email_confirm: true,
    });

    if (error) {
      throw new Error(`Failed to update auth user email: ${error.message}`);
    }

    console.log(`Auth user ${user_id} email updated to ${normalizedEmail}`);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error updating auth user email:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
