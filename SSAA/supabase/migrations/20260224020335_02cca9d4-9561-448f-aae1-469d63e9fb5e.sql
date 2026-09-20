
-- Migrate existing standard users to basic
UPDATE public.user_roles SET permission_level = 'basic' WHERE permission_level = 'standard';

-- Create has_level1_or_higher helper function
CREATE OR REPLACE FUNCTION public.has_level1_or_higher()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND company_id = get_user_company_id()
      AND permission_level IN ('level_1', 'partial', 'full', 'account_holder')
  ) OR is_moa()
$$;
