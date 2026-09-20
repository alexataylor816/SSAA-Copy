import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const log = (step: string, details?: any) => {
  const d = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[SYNC-PLAN-SUBSCRIBERS] ${step}${d}`);
};

/**
 * Re-prices every active Stripe subscription tied to a given plan (and optionally
 * filtered by discount_code_id). Called when an MOA edits a plan's price/cycle
 * or a discount code's value.
 *
 * Body: { plan_id?: string, discount_code_id?: string }
 * At least one of plan_id / discount_code_id must be provided.
 */
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
    if (!authHeader) throw new Error("No authorization header provided");
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError) throw new Error(`Authentication error: ${userError.message}`);
    const user = userData.user;
    if (!user) throw new Error("User not authenticated");

    // Only MOA can fan-out
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
    if (profile?.role !== "moa") throw new Error("Only operators can sync plan subscribers.");

    const { plan_id, discount_code_id } = await req.json();
    if (!plan_id && !discount_code_id) {
      throw new Error("Must provide plan_id or discount_code_id");
    }

    let query = supabase
      .from("company_subscriptions")
      .select("id, company_id, plan_id, billing_cycle, discount_code_id, stripe_subscription_id, status")
      .eq("status", "active")
      .not("stripe_subscription_id", "is", null);
    if (plan_id) query = query.eq("plan_id", plan_id);
    if (discount_code_id) query = query.eq("discount_code_id", discount_code_id);

    const { data: subs, error: subsErr } = await query;
    if (subsErr) throw subsErr;
    log("Subscribers found", { count: subs?.length || 0 });

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const results: any[] = [];

    for (const sub of subs || []) {
      try {
        const { data: plan } = await supabase
          .from("subscription_plans")
          .select("*")
          .eq("id", sub.plan_id)
          .single();
        if (!plan) {
          results.push({ company_id: sub.company_id, ok: false, error: "plan missing" });
          continue;
        }

        let basePrice = sub.billing_cycle === "annual" ? Number(plan.annual_price_per_month) : Number(plan.monthly_price);
        let finalPrice = basePrice;
        if (sub.discount_code_id) {
          const { data: discount } = await supabase
            .from("discount_codes")
            .select("*")
            .eq("id", sub.discount_code_id)
            .eq("is_active", true)
            .maybeSingle();
          if (discount) {
            if (discount.discount_percent) finalPrice = basePrice * (1 - Number(discount.discount_percent) / 100);
            else if (discount.discount_amount) finalPrice = Math.max(0, basePrice - Number(discount.discount_amount));
          }
        }
        const unitAmount = Math.round(finalPrice * 100);

        const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id!);
        const currentItem = stripeSub.items.data[0];
        if (!currentItem) {
          results.push({ company_id: sub.company_id, ok: false, error: "no stripe item" });
          continue;
        }

        const newPrice = await stripe.prices.create({
          currency: "usd",
          unit_amount: unitAmount,
          recurring: { interval: sub.billing_cycle === "annual" ? "year" : "month" },
          product_data: { name: `${plan.display_name} - Updated` },
        });

        await stripe.subscriptions.update(sub.stripe_subscription_id!, {
          items: [{ id: currentItem.id, price: newPrice.id }],
          proration_behavior: "create_prorations",
        });

        results.push({ company_id: sub.company_id, ok: true, new_price: finalPrice });
      } catch (e: any) {
        log("Sub failed", { company_id: sub.company_id, error: e?.message });
        results.push({ company_id: sub.company_id, ok: false, error: e?.message });
      }
    }

    return new Response(JSON.stringify({ synced: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("ERROR", { message: msg });
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
