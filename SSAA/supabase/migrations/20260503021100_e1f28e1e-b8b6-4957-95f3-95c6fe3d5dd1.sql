CREATE OR REPLACE FUNCTION public.can_assign_role(target_company_id uuid, target_permission permission_level)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    -- First-user bootstrap: the very first role of a brand-new company.
    -- Safe because the "no existing roles" check can only ever be true once
    -- per company, preventing any privilege escalation in existing companies.
    OR (
      target_permission IN ('account_holder', 'standard')
      AND auth.uid() IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE company_id = target_company_id
      )
    )
$function$;