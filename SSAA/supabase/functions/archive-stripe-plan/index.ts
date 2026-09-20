import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const log = (s: string, d?: any) =>
  console.log(`[ARCHIVE-STRIPE-PLAN] ${s}${d ? ` - ${JSON.stringify(d)}` : ""}`);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData.user) throw new Error("Authentication failed");

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (profile?.role !== "moa") throw new Error("Forbidden: MOA only");

    const body = await req.json();
    let { plan_id, stripe_product_id, stripe_monthly_price_id, stripe_annual_price_id } = body;

    // If plan_id provided, load IDs from DB (preferred path; row may still exist)
    if (plan_id) {
      const { data: plan } = await supabase
        .from("subscription_plans")
        .select("stripe_product_id, stripe_monthly_price_id, stripe_annual_price_id")
        .eq("id", plan_id)
        .maybeSingle();
      if (plan) {
        stripe_product_id = stripe_product_id || plan.stripe_product_id;
        stripe_monthly_price_id = stripe_monthly_price_id || plan.stripe_monthly_price_id;
        stripe_annual_price_id = stripe_annual_price_id || plan.stripe_annual_price_id;
      }
    }

    if (!stripe_product_id) {
      // Nothing to archive (plan was never synced)
      return new Response(JSON.stringify({ success: true, skipped: "no stripe product" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Archive prices first (existing subscriptions keep billing on these prices)
    for (const priceId of [stripe_monthly_price_id, stripe_annual_price_id]) {
      if (!priceId) continue;
      try {
        await stripe.prices.update(priceId, { active: false });
        log("Price archived", { priceId });
      } catch (e) {
        log("Failed to archive price", { priceId, e: String(e) });
      }
    }

    // Soft-archive the product. NEVER hard-delete: existing subs would break.
    try {
      await stripe.products.update(stripe_product_id, { active: false });
      log("Product archived", { stripe_product_id });
    } catch (e) {
      log("Failed to archive product", { stripe_product_id, e: String(e) });
    }

    // Audit log
    await supabase.from("notification_log").insert({
      event_type: "stripe_plan_archived",
      channel: "system",
      status: "sent",
      metadata: {
        plan_id: plan_id || null,
        stripe_product_id,
        stripe_monthly_price_id,
        stripe_annual_price_id,
        archived_by: userData.user.id,
      },
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("ERROR", { msg });
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
