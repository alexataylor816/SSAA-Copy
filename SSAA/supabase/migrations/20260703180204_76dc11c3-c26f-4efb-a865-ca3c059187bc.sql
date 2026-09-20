
-- 1. Atomic self-service guest account creation
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
  v_company_id uuid;
  v_project_id uuid;
  v_full_name text;
  v_email text;
  v_phone text;
  v_guest_plan_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id, full_name, email, phone
    INTO v_profile_id, v_full_name, v_email, v_phone
  FROM public.profiles
  WHERE user_id = v_uid;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Profile not found for authenticated user';
  END IF;

  INSERT INTO public.companies (name, company_type, address, subscription_status, is_guest)
  VALUES (btrim(p_company_name), 'gc', NULLIF(btrim(p_company_address), ''), 'guest', true)
  RETURNING id INTO v_company_id;

  UPDATE public.profiles
  SET company_id = v_company_id, updated_at = now()
  WHERE id = v_profile_id;

  INSERT INTO public.user_roles (user_id, company_id, permission_level, is_company_creator)
  VALUES (v_uid, v_company_id, 'account_holder', true);

  INSERT INTO public.employees (company_id, name, email, phone, linked_user_id)
  VALUES (v_company_id, COALESCE(NULLIF(v_full_name, ''), v_email), v_email, v_phone, v_uid)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.projects (company_id, name, address)
  VALUES (
    v_company_id,
    COALESCE(NULLIF(btrim(p_project_name), ''), btrim(p_company_name)),
    COALESCE(NULLIF(btrim(p_project_address), ''), NULLIF(btrim(p_company_address), ''))
  )
  RETURNING id INTO v_project_id;

  SELECT id INTO v_guest_plan_id FROM public.subscription_plans WHERE name = 'guest_gc' LIMIT 1;
  IF v_guest_plan_id IS NOT NULL THEN
    INSERT INTO public.company_subscriptions (company_id, plan_id, billing_cycle, status)
    VALUES (v_company_id, v_guest_plan_id, 'monthly', 'active');
  END IF;

  RETURN QUERY SELECT v_company_id, v_project_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_guest_gc_account(text, text, text, text) TO authenticated;

-- 2. Trigger: sync project_connections for guest-owned project_aliases
CREATE OR REPLACE FUNCTION public.tg_sync_guest_project_connection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_guest boolean;
  v_project_owner uuid;
  v_owner_is_sub boolean;
BEGIN
  SELECT is_guest INTO v_is_guest FROM public.companies WHERE id = NEW.company_id;
  IF v_is_guest IS NOT TRUE THEN RETURN NEW; END IF;

  SELECT p.company_id INTO v_project_owner FROM public.projects p WHERE p.id = NEW.project_id;
  IF v_project_owner IS NULL THEN RETURN NEW; END IF;

  SELECT (company_type = 'sub') INTO v_owner_is_sub FROM public.companies WHERE id = v_project_owner;
  IF v_owner_is_sub IS NOT TRUE THEN RETURN NEW; END IF;

  INSERT INTO public.project_connections (project_id, sub_company_id)
  VALUES (NEW.project_id, v_project_owner)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.guest_project_connections (guest_company_id, sub_company_id)
  VALUES (NEW.company_id, v_project_owner)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_guest_project_connection ON public.project_aliases;
CREATE TRIGGER trg_sync_guest_project_connection
AFTER INSERT OR UPDATE ON public.project_aliases
FOR EACH ROW EXECUTE FUNCTION public.tg_sync_guest_project_connection();

-- 3. Data repair: every guest-account user becomes account_holder
UPDATE public.user_roles ur
SET permission_level = 'account_holder', updated_at = now()
FROM public.companies c
WHERE ur.company_id = c.id
  AND c.is_guest = true
  AND ur.permission_level <> 'account_holder';

-- 4. Backfill: replay the trigger for all existing guest project_aliases so the
--    project_connections table catches up (fixes Testing Guest Functionality Test 1
--    <-> Circuit Electric and any similarly missing rows).
INSERT INTO public.project_connections (project_id, sub_company_id)
SELECT DISTINCT pa.project_id, p.company_id
FROM public.project_aliases pa
JOIN public.companies gc ON gc.id = pa.company_id AND gc.is_guest = true
JOIN public.projects p ON p.id = pa.project_id
JOIN public.companies sc ON sc.id = p.company_id AND sc.company_type = 'sub'
ON CONFLICT DO NOTHING;

INSERT INTO public.guest_project_connections (guest_company_id, sub_company_id)
SELECT DISTINCT pa.company_id, p.company_id
FROM public.project_aliases pa
JOIN public.companies gc ON gc.id = pa.company_id AND gc.is_guest = true
JOIN public.projects p ON p.id = pa.project_id
JOIN public.companies sc ON sc.id = p.company_id AND sc.company_type = 'sub'
ON CONFLICT DO NOTHING;
