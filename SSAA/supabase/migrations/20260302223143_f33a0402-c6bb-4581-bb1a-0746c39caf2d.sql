
-- Drop the overly permissive public SELECT policy
DROP POLICY "Anyone can view companies" ON public.companies;

-- Authenticated users can view their own company
CREATE POLICY "Users can view own company"
ON public.companies FOR SELECT TO authenticated
USING (id = get_user_company_id());

-- MOA can view all companies
CREATE POLICY "MOA can view all companies"
ON public.companies FOR SELECT TO authenticated
USING (is_moa());

-- Authenticated users can view companies during onboarding (search/join flow)
-- They need to list companies by type to find one to join
CREATE POLICY "Authenticated can view companies for joining"
ON public.companies FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL);
