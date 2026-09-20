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
  console.log(`[STRIPE-WEBHOOK] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    if (!webhookSecret) {
      throw new Error("STRIPE_WEBHOOK_SECRET is not configured. Webhook signature verification is required.");
    }

    const sig = req.headers.get("stripe-signature");
    if (!sig) {
      throw new Error("Missing stripe-signature header");
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const body = await req.text();
    const event = stripe.webhooks.constructEvent(body, sig, webhookSecret);

    logStep("Event received", { type: event.type, id: event.id });

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const companyId = session.metadata?.company_id;
        const planId = session.metadata?.plan_id;
        const billingCycle = session.metadata?.billing_cycle || "monthly";
        const discountCodeId = session.metadata?.discount_code_id || null;

        if (companyId) {
          await supabase
            .from("companies")
            .update({
              has_payment_method: true,
              stripe_customer_id: session.customer as string,
              subscription_status: "active",
            })
            .eq("id", companyId);

          if (planId && session.subscription) {
            const { data: existingSub } = await supabase
              .from("company_subscriptions")
              .select("id")
              .eq("company_id", companyId)
              .eq("status", "active")
              .maybeSingle();

            if (existingSub) {
              await supabase
                .from("company_subscriptions")
                .update({
                  stripe_subscription_id: session.subscription as string,
                  plan_id: planId,
                  billing_cycle: billingCycle,
                  discount_code_id: discountCodeId || null,
                  status: "active",
                })
                .eq("id", existingSub.id);
            } else {
              await supabase
                .from("company_subscriptions")
                .insert({
                  company_id: companyId,
                  plan_id: planId,
                  billing_cycle: billingCycle,
                  stripe_subscription_id: session.subscription as string,
                  discount_code_id: discountCodeId || null,
                  status: "active",
                });
            }
          }

          logStep("Checkout completed", { companyId, planId });
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const { data: sub } = await supabase
          .from("company_subscriptions")
          .select("id, company_id")
          .eq("stripe_subscription_id", subscription.id)
          .maybeSingle();

        if (sub) {
          await supabase
            .from("company_subscriptions")
            .update({ status: subscription.status })
            .eq("id", sub.id);

          if (subscription.status === "active") {
            await supabase
              .from("companies")
              .update({ subscription_status: "active" })
              .eq("id", sub.company_id);
          }
          logStep("Subscription updated", { subId: subscription.id, status: subscription.status });
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const { data: sub } = await supabase
          .from("company_subscriptions")
          .select("id, company_id")
          .eq("stripe_subscription_id", subscription.id)
          .maybeSingle();

        if (sub) {
          await supabase
            .from("company_subscriptions")
            .update({ status: "cancelled" })
            .eq("id", sub.id);

          await supabase
            .from("companies")
            .update({ subscription_status: "cancelled" })
            .eq("id", sub.company_id);
          logStep("Subscription cancelled", { subId: subscription.id });
        }
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.customer) {
          await supabase
            .from("companies")
            .update({ subscription_status: "active" })
            .eq("stripe_customer_id", invoice.customer as string);
        }
        logStep("Invoice paid", { invoiceId: invoice.id, customerId: invoice.customer });
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.customer) {
          await supabase
            .from("companies")
            .update({ subscription_status: "past_due" })
            .eq("stripe_customer_id", invoice.customer as string);
        }
        logStep("Payment failed", { invoiceId: invoice.id, customerId: invoice.customer });
        break;
      }

      default:
        logStep("Unhandled event type", { type: event.type });
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
