
-- Add free_period_months column to subscription_plans (null = no free period)
ALTER TABLE public.subscription_plans
ADD COLUMN free_period_months integer DEFAULT NULL;

-- Set the existing free trial to 3 months
UPDATE public.subscription_plans
SET free_period_months = 3
WHERE name = 'free_trial';
