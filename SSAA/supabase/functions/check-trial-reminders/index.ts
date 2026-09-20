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
      throw new Error("Supabase environment variables not configured");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const now = new Date();

    // Reminder intervals in days and their corresponding event_types
    const intervals = [
      { days: 14, event_type: "trial_expiry_14d" },
      { days: 7, event_type: "trial_expiry_7d" },
      { days: 2, event_type: "trial_expiry_2d" },
      { days: 1, event_type: "trial_expiry_1d" },
      { days: 0, event_type: "trial_expiry_today" },
    ];

    const results: any[] = [];

    for (const interval of intervals) {
      // Find companies whose trial expires on the target date
      const targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + interval.days);
      const targetDateStr = targetDate.toISOString().split("T")[0];

      // Get companies with trial status expiring on this date that haven't been notified yet
      const { data: companies, error: compError } = await supabase
        .from("companies")
        .select("id, name, subscription_ends_at, has_payment_method")
        .eq("subscription_status", "trial")
        .eq("has_payment_method", false)
        .gte("subscription_ends_at", `${targetDateStr}T00:00:00Z`)
        .lte("subscription_ends_at", `${targetDateStr}T23:59:59Z`);

      if (compError) {
        console.error(`Error fetching companies for ${interval.event_type}:`, compError);
        continue;
      }

      if (!companies || companies.length === 0) {
        console.log(`No companies found for ${interval.event_type}`);
        continue;
      }

      for (const company of companies) {
        // Check if we already sent this exact reminder
        const { data: existingLog } = await supabase
          .from("notification_log")
          .select("id")
          .eq("event_type", interval.event_type)
          .eq("recipient_company_id", company.id)
          .limit(1);

        if (existingLog && existingLog.length > 0) {
          console.log(`Already sent ${interval.event_type} to company ${company.id}`);
          continue;
        }

        // Get account holder email and phone for this company
        const { data: profiles } = await supabase
          .from("profiles")
          .select("email, phone")
          .eq("company_id", company.id);

        if (!profiles || profiles.length === 0) continue;

        const emails = profiles.map((p: any) => p.email).filter(Boolean);
        const phones = profiles.map((p: any) => p.phone).filter(Boolean);

        const expiryDate = company.subscription_ends_at
          ? new Date(company.subscription_ends_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
          : "soon";

        const variables = {
          company_name: company.name,
          expiry_date: expiryDate,
        };

        // Send email notification
        if (emails.length > 0) {
          try {
            const emailRes = await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              },
              body: JSON.stringify({
                event_type: interval.event_type,
                recipient_emails: emails,
                recipient_company_id: company.id,
                variables,
              }),
            });
            const emailData = await emailRes.json();
            results.push({ company: company.name, event: interval.event_type, channel: "email", result: emailData });
          } catch (e: any) {
            console.error(`Error sending email for ${interval.event_type} to ${company.name}:`, e);
          }
        }

        // Send SMS notification
        if (phones.length > 0) {
          try {
            const smsRes = await fetch(`${SUPABASE_URL}/functions/v1/send-sms`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              },
              body: JSON.stringify({
                event_type: interval.event_type,
                recipient_phones: phones,
                recipient_company_id: company.id,
                variables,
              }),
            });
            const smsData = await smsRes.json();
            results.push({ company: company.name, event: interval.event_type, channel: "sms", result: smsData });
          } catch (e: any) {
            console.error(`Error sending SMS for ${interval.event_type} to ${company.name}:`, e);
          }
        }
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error in check-trial-reminders:", error);
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
