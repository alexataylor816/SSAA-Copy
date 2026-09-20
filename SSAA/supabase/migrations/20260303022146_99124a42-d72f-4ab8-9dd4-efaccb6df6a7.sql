-- Drop the overly permissive policy that lets any authenticated user view ALL companies
DROP POLICY IF EXISTS "Authenticated can view companies for joining" ON public.companies;

-- Create a scoped policy: users can view companies they're connected to via projects
CREATE POLICY "Users can view connected companies"
ON public.companies FOR SELECT
USING (
  is_moa()
  OR id = get_user_company_id()
  OR id IN (
    -- GC companies whose projects the user's sub company is connected to
    SELECT DISTINCT p.company_id FROM public.projects p
    JOIN public.project_connections pc ON pc.project_id = p.id
    WHERE pc.sub_company_id = get_user_company_id()
  )
  OR id IN (
    -- Sub companies connected to the user's GC projects
    SELECT DISTINCT pc.sub_company_id FROM public.project_connections pc
    JOIN public.projects p ON p.id = pc.project_id
    WHERE p.company_id = get_user_company_id()
  )
  OR id IN (
    -- Guest GC connections
    SELECT DISTINCT gpc.guest_company_id FROM public.guest_project_connections gpc
    WHERE gpc.sub_company_id = get_user_company_id()
  )
  OR id IN (
    -- Sub companies visible to guest GCs
    SELECT DISTINCT gpc.sub_company_id FROM public.guest_project_connections gpc
    WHERE gpc.guest_company_id = get_user_company_id()
  )
);

-- Separate policy for onboarding: users without a company can search companies to join
-- This is limited to users who haven't completed onboarding (no company_id set)
CREATE POLICY "Onboarding users can search companies to join"
ON public.companies FOR SELECT
USING (
  auth.uid() IS NOT NULL
  AND get_user_company_id() IS NULL
);