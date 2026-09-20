import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREATE-CHECKOUT] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError) throw new Error(`Authentication error: ${userError.message}`);
    const user = userData.user;
    if (!user?.email) throw new Error("User not authenticated or email not available");
    logStep("User authenticated", { userId: user.id, email: user.email });

    const { plan_id, billing_cycle, discount_code_id, company_id, success_url, cancel_url } = await req.json();
    if (!plan_id || !company_id) throw new Error("Missing required fields: plan_id, company_id");

    // Fetch the plan
    let { data: plan, error: planError } = await supabase
      .from("subscription_plans")
      .select("*")
      .eq("id", plan_id)
      .single();
    if (planError || !plan) throw new Error("Plan not found");
    if (!plan.is_active) throw new Error("Plan not found");
    logStep("Plan fetched", { planName: plan.name });

    const cycle = billing_cycle || "monthly";

    // Lazy-provision Stripe product/prices if missing
    const needsSync =
      !plan.stripe_product_id ||
      (cycle === "monthly" && !plan.stripe_monthly_price_id) ||
      (cycle === "annual" && !plan.stripe_annual_price_id);

    if (needsSync) {
      logStep("Lazy provisioning Stripe plan");
      const syncRes = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/upsert-stripe-plan`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
          },
          body: JSON.stringify({ plan_id }),
        }
      );
      if (!syncRes.ok) {
        const errTxt = await syncRes.text();
        throw new Error(`Stripe plan sync failed: ${errTxt}`);
      }
      const refreshed = await supabase
        .from("subscription_plans")
        .select("*")
        .eq("id", plan_id)
        .single();
      if (refreshed.data) plan = refreshed.data;
    }

    const priceId =
      cycle === "annual" ? plan.stripe_annual_price_id : plan.stripe_monthly_price_id;
    if (!priceId) throw new Error("Plan not found");
    logStep("Using Stripe price", { priceId, cycle });

    // Track discount usage (Stripe handles actual discount via allow_promotion_codes / coupons)
    if (discount_code_id) {
      const { data: discount } = await supabase
        .from("discount_codes")
        .select("*")
        .eq("id", discount_code_id)
        .eq("is_active", true)
        .single();
      if (discount) {
        await supabase
          .from("discount_codes")
          .update({ current_uses: discount.current_uses + 1 })
          .eq("id", discount.id);
      }
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    const { data: company } = await supabase
      .from("companies")
      .select("stripe_customer_id, name")
      .eq("id", company_id)
      .single();

    let customerId = company?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: company?.name || user.email,
        metadata: { company_id, user_id: user.id },
      });
      customerId = customer.id;
      await supabase
        .from("companies")
        .update({ stripe_customer_id: customerId })
        .eq("id", company_id);
      logStep("Stripe customer created", { customerId });
    }

    const origin = req.headers.get("origin") || "http://localhost:3000";

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      payment_method_collection: "always",
      allow_promotion_codes: true,
      success_url: success_url || `${origin}/dashboard?checkout=success`,
      cancel_url: cancel_url || `${origin}/dashboard?checkout=cancelled`,
      metadata: {
        company_id,
        plan_id,
        billing_cycle: cycle,
        discount_code_id: discount_code_id || "",
      },
    });

    logStep("Checkout session created", { sessionId: session.id, url: session.url });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    // Return generic error to client, keep details server-side
    const safeMessages: Record<string, string> = {
      "STRIPE_SECRET_KEY is not set": "Payment service is not configured.",
      "No authorization header provided": "Authentication required.",
      "Plan not found": "The selected plan is no longer available.",
      "Missing required fields": "Missing required information.",
    };
    const clientMessage = Object.entries(safeMessages).find(([key]) => errorMessage.includes(key))?.[1]
      || "An error occurred processing your request. Please try again.";
    return new Response(JSON.stringify({ error: clientMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
