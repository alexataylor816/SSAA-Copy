
CREATE OR REPLACE FUNCTION public.get_primary_account_holder_for_company(p_company_id uuid)
RETURNS TABLE(
  profile_id uuid,
  user_id uuid,
  full_name text,
  email text,
  company_id uuid,
  company_name text,
  company_type public.company_type
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_is_guest boolean;
BEGIN
  IF NOT public.is_moa() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT c.is_guest INTO v_is_guest FROM public.companies c WHERE c.id = p_company_id;

  IF v_is_guest IS TRUE THEN
    RETURN QUERY
    SELECT p.id, p.user_id, p.full_name, p.email, c.id, c.name, c.company_type
    FROM public.user_roles ur
    JOIN public.profiles p ON p.user_id = ur.user_id
    JOIN public.companies c ON c.id = ur.company_id
    LEFT JOIN auth.users u ON u.id = ur.user_id
    WHERE ur.company_id = p_company_id
      AND ur.permission_level = 'account_holder'
    ORDER BY u.last_sign_in_at ASC NULLS LAST, ur.created_at ASC
    LIMIT 1;
  ELSE
    RETURN QUERY
    SELECT p.id, p.user_id, p.full_name, p.email, c.id, c.name, c.company_type
    FROM public.user_roles ur
    JOIN public.profiles p ON p.user_id = ur.user_id
    JOIN public.companies c ON c.id = ur.company_id
    WHERE ur.company_id = p_company_id
      AND ur.permission_level = 'account_holder'
    ORDER BY ur.created_at ASC
    LIMIT 1;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_primary_account_holder_for_company(uuid) TO authenticated;
