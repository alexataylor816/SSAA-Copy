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
  console.log(`[UPDATE-STRIPE-SUB] ${step}${detailsStr}`);
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

    // Authenticate - must be MOA or account holder
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError) throw new Error(`Authentication error: ${userError.message}`);

    const { company_id, plan_id, billing_cycle, discount_code_id } = await req.json();
    if (!company_id) throw new Error("Missing required field: company_id");

    // Get the company's subscription
    const { data: subscription, error: subError } = await supabase
      .from("company_subscriptions")
      .select("*, subscription_plans(*)")
      .eq("company_id", company_id)
      .eq("status", "active")
      .maybeSingle();

    if (subError || !subscription) {
      throw new Error("No active subscription found for this company");
    }

    if (!subscription.stripe_subscription_id) {
      throw new Error("No Stripe subscription linked to this company");
    }

    // Determine which plan to use
    const targetPlanId = plan_id || subscription.plan_id;
    const targetCycle = billing_cycle || subscription.billing_cycle;

    // Fetch the target plan
    const { data: plan } = await supabase
      .from("subscription_plans")
      .select("*")
      .eq("id", targetPlanId)
      .single();
    if (!plan) throw new Error("Plan not found");

    // Calculate price
    let basePrice = targetCycle === "annual" ? plan.annual_price_per_month : plan.monthly_price;
    let finalPrice = basePrice;

    // Apply discount if provided
    const targetDiscountId = discount_code_id !== undefined ? discount_code_id : subscription.discount_code_id;
    if (targetDiscountId) {
      const { data: discount } = await supabase
        .from("discount_codes")
        .select("*")
        .eq("id", targetDiscountId)
        .eq("is_active", true)
        .single();

      if (discount) {
        if (discount.discount_percent) {
          finalPrice = basePrice * (1 - discount.discount_percent / 100);
        } else if (discount.discount_amount) {
          finalPrice = Math.max(0, basePrice - Number(discount.discount_amount));
        }
        logStep("Discount applied", { code: discount.code, finalPrice });
      }
    }

    const unitAmount = Math.round(finalPrice * 100);
    logStep("New price calculated", { finalPrice, unitAmountCents: unitAmount });

    // Update the Stripe subscription
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);
    const currentItem = stripeSubscription.items.data[0];

    if (!currentItem) throw new Error("No subscription items found on Stripe subscription");

    // Create a new price and update the subscription item
    const newPrice = await stripe.prices.create({
      currency: "usd",
      unit_amount: unitAmount,
      recurring: { interval: targetCycle === "annual" ? "year" : "month" },
      product_data: {
        name: `${plan.display_name} - Updated`,
      },
    });

    await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      items: [
        {
          id: currentItem.id,
          price: newPrice.id,
        },
      ],
      proration_behavior: "create_prorations",
    });

    // Update local subscription record
    await supabase
      .from("company_subscriptions")
      .update({
        plan_id: targetPlanId,
        billing_cycle: targetCycle,
        discount_code_id: targetDiscountId || null,
      })
      .eq("id", subscription.id);

    logStep("Subscription updated successfully", { companyId: company_id, newPrice: finalPrice });

    return new Response(JSON.stringify({ success: true, new_price: finalPrice }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
