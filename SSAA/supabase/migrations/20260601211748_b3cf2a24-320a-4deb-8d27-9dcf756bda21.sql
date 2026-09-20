ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS stripe_product_id text,
  ADD COLUMN IF NOT EXISTS stripe_monthly_price_id text,
  ADD COLUMN IF NOT EXISTS stripe_annual_price_id text,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;