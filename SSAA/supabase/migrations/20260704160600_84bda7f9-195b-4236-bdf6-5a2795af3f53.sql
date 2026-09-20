CREATE OR REPLACE FUNCTION public.request_company_deletion(
  p_company_id uuid DEFAULT NULL,
  p_target_user_id uuid DEFAULT NULL
)
RETURNS TABLE(request_id uuid, company_id uuid, already_pending boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_moa boolean := public.is_moa();
  v_company_id uuid;
  v_target_user_id uuid;
  v_existing_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_target_user_id := COALESCE(p_target_user_id, v_uid);

  IF v_target_user_id <> v_uid AND NOT v_is_moa THEN
    RAISE EXCEPTION 'Only operators can request deletion for another user';
  END IF;

  IF p_company_id IS NOT NULL THEN
    v_company_id := p_company_id;
  ELSE
    SELECT p.company_id INTO v_company_id
    FROM public.profiles p
    WHERE p.user_id = v_target_user_id
    LIMIT 1;
  END IF;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'This user is not connected to a company account yet';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = v_company_id) THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  IF NOT v_is_moa THEN
    IF v_company_id IS DISTINCT FROM public.get_user_company_id() OR NOT public.is_account_holder(v_company_id) THEN
      RAISE EXCEPTION 'Only the main account holder can request account deletion';
    END IF;
  END IF;

  SELECT cdr.id INTO v_existing_id
  FROM public.company_deletion_requests cdr
  WHERE cdr.company_id = v_company_id
    AND cdr.status = 'pending'
  ORDER BY cdr.created_at DESC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN QUERY SELECT v_existing_id, v_company_id, true;
    RETURN;
  END IF;

  INSERT INTO public.company_deletion_requests (company_id, requested_by, status)
  VALUES (v_company_id, v_target_user_id, 'pending')
  RETURNING company_deletion_requests.id INTO v_existing_id;

  RETURN QUERY SELECT v_existing_id, v_company_id, false;
END;
$$;

REVOKE ALL ON FUNCTION public.request_company_deletion(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_company_deletion(uuid, uuid) TO authenticated;