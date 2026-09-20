import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TOUCHPOINTS = [
  "guest_gc_touchpoint_1",
  "guest_gc_touchpoint_2",
  "guest_gc_touchpoint_3",
];

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase environment variables not configured");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const now = new Date();
    const results: any[] = [];

    // Get all touchpoint templates with their frequency settings
    const { data: templates, error: templatesError } = await supabase
      .from("notification_templates")
      .select("*")
      .in("event_type", TOUCHPOINTS)
      .eq("channel", "email")
      .eq("is_active", true);

    if (templatesError || !templates || templates.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No active touchpoint templates found", results }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Build a map of event_type -> frequency_days
    const frequencyMap: Record<string, number> = {};
    for (const t of templates) {
      const freq = t.metadata?.frequency_days || 14; // default 2 weeks
      frequencyMap[t.event_type] = freq;
    }

    // Get all guest GC companies
    const { data: guestCompanies, error: guestError } = await supabase
      .from("companies")
      .select("id, name")
      .eq("is_guest", true)
      .eq("company_type", "gc");

    if (guestError || !guestCompanies || guestCompanies.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No guest GC companies found", results }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    for (const company of guestCompanies) {
      // Get all touchpoint logs for this company
      const { data: logs } = await supabase
        .from("notification_log")
        .select("event_type, created_at")
        .eq("recipient_company_id", company.id)
        .in("event_type", TOUCHPOINTS)
        .eq("status", "sent")
        .order("created_at", { ascending: false });

      const sentTypes = new Set((logs || []).map((l: any) => l.event_type));

      // Determine which touchpoint to send next
      let nextTouchpoint: string | null = null;
      for (const tp of TOUCHPOINTS) {
        if (!sentTypes.has(tp)) {
          nextTouchpoint = tp;
          break;
        }
      }

      // All touchpoints sent — skip this company
      if (!nextTouchpoint) continue;

      // Check if enough time has passed since the last touchpoint
      if (logs && logs.length > 0) {
        const lastSent = new Date(logs[0].created_at);
        const lastEventType = logs[0].event_type;
        const frequencyDays = frequencyMap[lastEventType] || 14;
        const daysSinceLast = (now.getTime() - lastSent.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceLast < frequencyDays) continue;
      }

      // Get the guest GC's project and connection code
      const { data: projectData } = await supabase
        .from("projects")
        .select("name, connection_code")
        .eq("company_id", company.id)
        .limit(1)
        .single();

      // Get profile emails for this company
      const { data: profiles } = await supabase
        .from("profiles")
        .select("email")
        .eq("company_id", company.id);

      if (!profiles || profiles.length === 0) continue;

      const emails = profiles.map((p: any) => p.email).filter(Boolean);
      if (emails.length === 0) continue;

      const variables = {
        company_name: company.name,
        project_name: projectData?.name || "your project",
        connection_code: projectData?.connection_code || "",
      };

      // Send email notification via send-notification
      try {
        const emailRes = await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            event_type: nextTouchpoint,
            recipient_emails: emails,
            recipient_company_id: company.id,
            variables,
          }),
        });
        const emailData = await emailRes.json();
        results.push({
          company: company.name,
          touchpoint: nextTouchpoint,
          result: emailData,
        });
      } catch (e: any) {
        console.error(`Error sending ${nextTouchpoint} to ${company.name}:`, e);
        results.push({
          company: company.name,
          touchpoint: nextTouchpoint,
          error: e.message,
        });
      }
    }

    return new Response(
      JSON.stringify({ success: true, results }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in check-guest-gc-outreach:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
