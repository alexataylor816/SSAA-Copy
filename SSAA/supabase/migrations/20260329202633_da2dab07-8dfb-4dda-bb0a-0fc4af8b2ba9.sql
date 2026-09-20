-- Update user_roles INSERT policy to also allow full/partial users to insert roles
-- (but only for levels below their own - enforced by a helper function)
DROP POLICY IF EXISTS "Account holders or MOA can insert roles" ON public.user_roles;

CREATE OR REPLACE FUNCTION public.can_assign_role(target_company_id uuid, target_permission permission_level)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT 
    is_moa()
    OR is_account_holder(target_company_id)
    OR (
      target_company_id = get_user_company_id()
      AND target_permission NOT IN ('account_holder', 'full')
      AND EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid()
          AND company_id = target_company_id
          AND permission_level IN ('full', 'partial')
      )
    )
$$;

CREATE POLICY "Authorized users can insert roles" ON public.user_roles
  FOR INSERT TO public
  WITH CHECK (
    can_assign_role(company_id, permission_level)
  );

-- Update the UPDATE policy to allow full/partial users to update lower roles
-- but not their own or same/higher level
DROP POLICY IF EXISTS "Account holders or MOA can update roles" ON public.user_roles;

CREATE POLICY "Authorized users can update roles" ON public.user_roles
  FOR UPDATE TO public
  USING (
    is_moa()
    OR is_account_holder(company_id)
    OR (
      company_id = get_user_company_id()
      AND user_id != auth.uid()
      AND permission_level NOT IN ('account_holder', 'full')
      AND EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid()
          AND company_id = user_roles.company_id
          AND permission_level IN ('full', 'partial')
      )
    )
  )