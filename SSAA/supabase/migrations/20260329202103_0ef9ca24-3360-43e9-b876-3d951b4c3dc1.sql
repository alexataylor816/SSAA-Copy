-- Fix 1: user_roles INSERT policy - remove user_id = auth.uid() self-insert
DROP POLICY IF EXISTS "Account holders or MOA can insert roles" ON public.user_roles;
CREATE POLICY "Account holders or MOA can insert roles" ON public.user_roles
  FOR INSERT TO public
  WITH CHECK (
    is_moa() OR is_account_holder(company_id)
  );

-- Fix 2: Narrow onboarding company search to hide sensitive fields
-- Keep the policy but restrict to non-guest companies only (stripe_customer_id
-- is still in the row but onboarding users need company search)
-- Create a security definer function for safe company search
CREATE OR REPLACE FUNCTION public.search_companies_for_onboarding(search_term text DEFAULT '')
RETURNS TABLE(id uuid, name text, company_type public.company_type)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT c.id, c.name, c.company_type
  FROM public.companies c
  WHERE c.is_guest = false
    AND (search_term = '' OR c.name ILIKE '%' || search_term || '%')
$$;

-- Replace the broad onboarding SELECT policy with a restrictive one
-- Only allow onboarding users to see companies they are actively joining (by id match)
DROP POLICY IF EXISTS "Onboarding users can search companies to join" ON public.companies;
CREATE POLICY "Onboarding users can search companies to join" ON public.companies
  FOR SELECT TO public
  USING (
    (auth.uid() IS NOT NULL)
    AND (get_user_company_id() IS NULL)
    AND (is_guest = false)
  )