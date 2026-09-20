
CREATE OR REPLACE FUNCTION public.check_user_never_logged_in(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (last_sign_in_at IS NULL)
  FROM auth.users
  WHERE id = p_user_id
$$;
