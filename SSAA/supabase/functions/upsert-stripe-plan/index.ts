import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const log = (s: string, d?: any) =>
  console.log(`[UPSERT-STRIPE-PLAN] ${s}${d ? ` - ${JSON.stringify(d)}` : ""}`);

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

    // Auth + MOA check
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

    const { plan_id } = await req.json();
    if (!plan_id) throw new Error("Missing plan_id");

    const { data: plan, error: planErr } = await supabase
      .from("subscription_plans")
      .select("*")
      .eq("id", plan_id)
      .single();
    if (planErr || !plan) throw new Error("Plan not found");

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // --- 1. Product upsert ---
    let productId = plan.stripe_product_id as string | null;
    const productPayload = {
      name: plan.display_name,
      description: `${plan.display_name} subscription plan`,
      active: true,
    };

    if (!productId) {
      const product = await stripe.products.create(productPayload);
      productId = product.id;
      log("Product created", { productId });
    } else {
      await stripe.products.update(productId, productPayload);
      log("Product updated", { productId });
    }

    // --- 2. Price upsert per interval ---
    const updates: Record<string, any> = {
      stripe_product_id: productId,
      last_synced_at: new Date().toISOString(),
    };

    const syncPrice = async (
      interval: "month" | "year",
      amount: number,
      currentPriceId: string | null,
      column: "stripe_monthly_price_id" | "stripe_annual_price_id"
    ) => {
      const unitAmount = Math.round(Number(amount) * 100);
      if (unitAmount <= 0) {
        // No paid price for this interval; archive existing if any
        if (currentPriceId) {
          try {
            await stripe.prices.update(currentPriceId, { active: false });
          } catch (e) {
            log("Failed to archive price", { currentPriceId, e: String(e) });
          }
          updates[column] = null;
        }
        return;
      }

      if (currentPriceId) {
        try {
          const existing = await stripe.prices.retrieve(currentPriceId);
          if (existing.unit_amount === unitAmount && existing.active) {
            return; // no change
          }
          await stripe.prices.update(currentPriceId, { active: false });
        } catch (e) {
          log("Existing price retrieve failed; will create new", { e: String(e) });
        }
      }

      const newPrice = await stripe.prices.create({
        product: productId!,
        currency: "usd",
        unit_amount: unitAmount,
        recurring: { interval },
      });
      updates[column] = newPrice.id;
      log("Price created", { interval, priceId: newPrice.id, unitAmount });
    };

    await syncPrice(
      "month",
      Number(plan.monthly_price),
      plan.stripe_monthly_price_id,
      "stripe_monthly_price_id"
    );
    await syncPrice(
      "year",
      Number(plan.annual_price_per_month) * 12,
      plan.stripe_annual_price_id,
      "stripe_annual_price_id"
    );

    const { error: upErr } = await supabase
      .from("subscription_plans")
      .update(updates)
      .eq("id", plan_id);
    if (upErr) throw upErr;

    return new Response(JSON.stringify({ success: true, ...updates }), {
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
