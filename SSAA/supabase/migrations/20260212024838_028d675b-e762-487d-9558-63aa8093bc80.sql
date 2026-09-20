
-- Drop the restrictive SELECT policy and recreate as permissive
DROP POLICY IF EXISTS "Authenticated users can read plans" ON public.subscription_plans;

CREATE POLICY "Anyone can read active plans"
ON public.subscription_plans
FOR SELECT
USING (true);
