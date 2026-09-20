
-- Add has_payment_method and stripe_customer_id to companies
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS has_payment_method boolean NOT NULL DEFAULT false;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS stripe_customer_id text;

-- Add stripe_subscription_id to company_subscriptions
ALTER TABLE public.company_subscriptions ADD COLUMN IF NOT EXISTS stripe_subscription_id text;
