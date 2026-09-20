CREATE OR REPLACE FUNCTION public.list_company_contact_candidates(p_company_id uuid, p_acting_company_id uuid DEFAULT NULL)
RETURNS TABLE(user_id uuid, full_name text, job_title text, email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acting uuid;
  v_is_operator boolean;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN;
  END IF;

  SELECT (pr.role = 'moa') OR EXISTS (SELECT 1 FROM public.operators o WHERE o.user_id = auth.uid())
    INTO v_is_operator
  FROM public.profiles pr
  WHERE pr.user_id = auth.uid();

  v_is_operator := COALESCE(v_is_operator, false);

  IF v_is_operator AND p_acting_company_id IS NOT NULL THEN
    v_acting := p_acting_company_id;
  ELSE
    SELECT pr.company_id INTO v_acting FROM public.profiles pr WHERE pr.user_id = auth.uid();
  END IF;

  IF v_acting IS NULL THEN
    RETURN;
  END IF;

  IF NOT v_is_operator AND NOT EXISTS (
    SELECT 1 FROM public.companies c WHERE c.id = v_acting AND c.company_type = 'sub'
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.user_id, p.full_name, e.job_title, p.email
  FROM public.profiles p
  LEFT JOIN public.employees e ON e.linked_user_id = p.user_id AND e.company_id = p_company_id
  WHERE p.company_id = p_company_id
  ORDER BY COALESCE(p.full_name, p.email);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_company_contact_candidates(uuid, uuid) TO authenticated;