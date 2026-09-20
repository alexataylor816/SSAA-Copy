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

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Fetch pending sync queue items
    const { data: pending, error: fetchError } = await adminClient
      .from("profile_email_sync_queue")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(50);

    if (fetchError) {
      throw new Error(`Failed to fetch sync queue: ${fetchError.message}`);
    }

    if (!pending || pending.length === 0) {
      return new Response(
        JSON.stringify({ processed: 0, message: "No pending syncs" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    let successCount = 0;
    let failCount = 0;

    for (const item of pending) {
      try {
        const normalizedEmail = item.new_email.trim().toLowerCase();

        // Update auth user email
        const { error: authError } = await adminClient.auth.admin.updateUserById(
          item.user_id,
          { email: normalizedEmail, email_confirm: true }
        );

        if (authError) {
          throw new Error(authError.message);
        }

        // Mark as processed
        await adminClient
          .from("profile_email_sync_queue")
          .update({ status: "processed", processed_at: new Date().toISOString() })
          .eq("id", item.id);

        successCount++;
        console.log(`Synced auth email for user ${item.user_id} to ${normalizedEmail}`);
      } catch (itemError: any) {
        failCount++;
        console.error(`Failed to sync email for user ${item.user_id}:`, itemError.message);

        await adminClient
          .from("profile_email_sync_queue")
          .update({
            status: "failed",
            error_message: itemError.message,
            processed_at: new Date().toISOString(),
          })
          .eq("id", item.id);
      }
    }

    return new Response(
      JSON.stringify({ processed: successCount, failed: failCount }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error processing email sync queue:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
