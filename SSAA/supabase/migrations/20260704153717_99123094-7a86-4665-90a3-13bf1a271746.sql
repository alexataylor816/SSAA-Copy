CREATE OR REPLACE FUNCTION public.create_guest_gc_account(
  p_company_name text,
  p_company_address text,
  p_project_name text,
  p_project_address text
)
RETURNS TABLE(company_id uuid, project_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile_id uuid;
  v_existing_company_id uuid;
  v_existing_company_is_guest boolean;
  v_existing_company_type public.company_type;
  v_company_id uuid;
  v_project_id uuid;
  v_full_name text;
  v_email text;
  v_phone text;
  v_guest_plan_id uuid;
  v_company_name text := NULLIF(btrim(COALESCE(p_company_name, '')), '');
  v_company_address text := NULLIF(btrim(COALESCE(p_company_address, '')), '');
  v_project_name text := NULLIF(btrim(COALESCE(p_project_name, '')), '');
  v_project_address text := NULLIF(btrim(COALESCE(p_project_address, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_company_name IS NULL THEN
    RAISE EXCEPTION 'Company name is required';
  END IF;

  IF v_project_name IS NULL THEN
    RAISE EXCEPTION 'Project name is required';
  END IF;

  IF v_project_address IS NULL THEN
    RAISE EXCEPTION 'Project address is required';
  END IF;

  SELECT id, company_id, full_name, email, phone
    INTO v_profile_id, v_existing_company_id, v_full_name, v_email, v_phone
  FROM public.profiles
  WHERE user_id = v_uid
  LIMIT 1;

  IF v_profile_id IS NULL THEN
    SELECT lower(email), COALESCE(raw_user_meta_data ->> 'full_name', email)
      INTO v_email, v_full_name
    FROM auth.users
    WHERE id = v_uid;

    IF v_email IS NULL THEN
      RAISE EXCEPTION 'Profile not found for authenticated user';
    END IF;

    INSERT INTO public.profiles (user_id, email, full_name, role, company_id)
    VALUES (v_uid, v_email, v_full_name, 'admin'::public.user_role, NULL)
    RETURNING id, company_id, full_name, email, phone
      INTO v_profile_id, v_existing_company_id, v_full_name, v_email, v_phone;
  END IF;

  IF v_existing_company_id IS NOT NULL THEN
    SELECT is_guest, company_type
      INTO v_existing_company_is_guest, v_existing_company_type
    FROM public.companies
    WHERE id = v_existing_company_id;

    IF v_existing_company_is_guest IS TRUE AND v_existing_company_type = 'gc' THEN
      v_company_id := v_existing_company_id;
    ELSE
      RAISE EXCEPTION 'ACCOUNT_ALREADY_HAS_COMPANY';
    END IF;
  ELSE
    INSERT INTO public.companies (
      name,
      company_type,
      address,
      subscription_status,
      is_guest,
      has_payment_method
    )
    VALUES (
      v_company_name,
      'gc'::public.company_type,
      v_company_address,
      'active',
      true,
      false
    )
    RETURNING id INTO v_company_id;

    UPDATE public.profiles
    SET company_id = v_company_id, updated_at = now()
    WHERE id = v_profile_id;
  END IF;

  INSERT INTO public.user_roles (user_id, company_id, permission_level, is_company_creator)
  VALUES (v_uid, v_company_id, 'account_holder'::public.permission_level, v_existing_company_id IS NULL)
  ON CONFLICT (user_id, company_id) DO UPDATE
    SET permission_level = 'account_holder'::public.permission_level,
        is_company_creator = public.user_roles.is_company_creator OR EXCLUDED.is_company_creator,
        updated_at = now();

  IF NOT EXISTS (
    SELECT 1 FROM public.employees
    WHERE company_id = v_company_id AND linked_user_id = v_uid
  ) THEN
    INSERT INTO public.employees (company_id, name, email, phone, linked_user_id)
    VALUES (v_company_id, COALESCE(NULLIF(v_full_name, ''), v_email), v_email, v_phone, v_uid);
  END IF;

  SELECT id INTO v_project_id
  FROM public.projects
  WHERE company_id = v_company_id
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_project_id IS NULL THEN
    INSERT INTO public.projects (company_id, name, address, owner_display_name)
    VALUES (
      v_company_id,
      COALESCE(v_project_name, v_company_name, 'Guest Project'),
      COALESCE(v_project_address, v_company_address),
      v_company_name
    )
    RETURNING id INTO v_project_id;
  END IF;

  SELECT id INTO v_guest_plan_id
  FROM public.subscription_plans
  WHERE name = 'guest_gc'
  LIMIT 1;

  IF v_guest_plan_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_subscriptions WHERE company_id = v_company_id
  ) THEN
    INSERT INTO public.company_subscriptions (company_id, plan_id, billing_cycle, status)
    VALUES (v_company_id, v_guest_plan_id, 'monthly', 'active');
  END IF;

  PERFORM public.assign_guest_company_users_to_project(v_company_id, v_project_id);

  RETURN QUERY SELECT v_company_id, v_project_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_guest_gc_account(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_guest_gc_account(text, text, text, text) TO authenticated;