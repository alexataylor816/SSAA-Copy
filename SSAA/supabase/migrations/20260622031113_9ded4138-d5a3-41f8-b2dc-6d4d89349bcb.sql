CREATE OR REPLACE FUNCTION public.get_company_usage(p_company_id uuid)
RETURNS TABLE(project_count integer, employee_count integer, max_projects integer, max_users integer, plan_display_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(*)::int FROM public.projects WHERE company_id = p_company_id),
    (SELECT COUNT(*)::int FROM public.employees WHERE company_id = p_company_id),
    COALESCE(sp.max_projects, 999999),
    COALESCE(sp.max_users, 999999),
    COALESCE(sp.display_name, 'Trial')
  FROM public.companies c
  LEFT JOIN public.company_subscriptions cs
    ON cs.company_id = c.id AND cs.status IN ('active','trial')
  LEFT JOIN public.subscription_plans sp
    ON sp.id = cs.plan_id
  WHERE c.id = p_company_id
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_company_usage(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_project_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count int; v_max int;
BEGIN
  IF public.is_moa() THEN RETURN NEW; END IF;
  IF NEW.company_id IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(sp.max_projects, 999999) INTO v_max
  FROM public.companies c
  LEFT JOIN public.company_subscriptions cs ON cs.company_id = c.id AND cs.status IN ('active','trial')
  LEFT JOIN public.subscription_plans sp ON sp.id = cs.plan_id
  WHERE c.id = NEW.company_id;

  SELECT COUNT(*) INTO v_count FROM public.projects WHERE company_id = NEW.company_id;

  IF v_count >= COALESCE(v_max, 999999) THEN
    RAISE EXCEPTION 'PROJECT_LIMIT_REACHED: This company has reached its plan limit of % projects. Upgrade plan or delete an existing project.', v_max
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_employee_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count int; v_max int;
BEGIN
  IF public.is_moa() THEN RETURN NEW; END IF;
  IF NEW.company_id IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(sp.max_users, 999999) INTO v_max
  FROM public.companies c
  LEFT JOIN public.company_subscriptions cs ON cs.company_id = c.id AND cs.status IN ('active','trial')
  LEFT JOIN public.subscription_plans sp ON sp.id = cs.plan_id
  WHERE c.id = NEW.company_id;

  SELECT COUNT(*) INTO v_count FROM public.employees WHERE company_id = NEW.company_id;

  IF v_count >= COALESCE(v_max, 999999) THEN
    RAISE EXCEPTION 'EMPLOYEE_LIMIT_REACHED: This company has reached its plan limit of % employees. Upgrade plan or remove an existing employee.', v_max
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;