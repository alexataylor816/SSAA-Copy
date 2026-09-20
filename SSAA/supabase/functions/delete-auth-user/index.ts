import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    // Allow service-role calls (from DB triggers) to bypass MOA check
    const isServiceRole = authHeader.includes(serviceRoleKey);

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { user_id } = await req.json();
    if (!user_id) {
      throw new Error("Missing required field: user_id");
    }

    if (!isServiceRole) {
      const callerClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });

      const { data: callerData, error: callerError } = await callerClient.auth.getUser();
      if (callerError || !callerData?.user) {
        throw new Error("Unauthorized");
      }
      const callerId = callerData.user.id;

      const { data: callerProfile } = await adminClient
        .from("profiles")
        .select("role")
        .eq("user_id", callerId)
        .maybeSingle();

      let allowed = callerProfile?.role === "moa";

      if (!allowed) {
        const { data: operatorRow } = await adminClient
          .from("operators")
          .select("user_id")
          .eq("user_id", callerId)
          .maybeSingle();
        allowed = !!operatorRow;
      }

      if (!allowed) {
        // Company admins may delete logins belonging to their own company.
        const { data: targetProfile } = await adminClient
          .from("profiles")
          .select("company_id")
          .eq("user_id", user_id)
          .maybeSingle();

        if (targetProfile?.company_id) {
          const { data: callerRole } = await adminClient
            .from("user_roles")
            .select("permission_level")
            .eq("user_id", callerId)
            .eq("company_id", targetProfile.company_id)
            .maybeSingle();
          allowed = !!callerRole && ["account_holder", "full"].includes(callerRole.permission_level as string);
        }
      }

      if (!allowed) {
        throw new Error("Unauthorized: you cannot delete this login");
      }
    }

    // Use service role to delete from auth
    const { error } = await adminClient.auth.admin.deleteUser(user_id);

    if (error) {
      throw new Error(`Failed to delete auth user: ${error.message}`);
    }

    console.log(`Auth user ${user_id} deleted successfully by MOA`);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error deleting auth user:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
