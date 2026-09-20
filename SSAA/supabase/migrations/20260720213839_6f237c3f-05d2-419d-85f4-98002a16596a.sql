
-- 1. Rewrite sync_contacts_for_project to same-company only
CREATE OR REPLACE FUNCTION public.sync_contacts_for_project(p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_company uuid;
BEGIN
  SELECT company_id INTO v_owner_company FROM public.projects WHERE id = p_project_id;
  IF v_owner_company IS NULL THEN RETURN; END IF;
  PERFORM public.sync_company_contacts(v_owner_company);
END;
$$;

-- 2. New same-company sync
CREATE OR REPLACE FUNCTION public.sync_company_contacts(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_company_id IS NULL THEN RETURN; END IF;
  INSERT INTO public.contacts (owner_user_id, contact_user_id, name, company_name, phone, email, source)
  SELECT a.user_id, b.user_id,
         COALESCE(bp.full_name, bp.email),
         bc.name, bp.phone, bp.email, 'auto_project'
  FROM public.profiles a
  JOIN public.profiles b
    ON b.company_id = a.company_id AND b.user_id <> a.user_id
  JOIN public.profiles bp ON bp.user_id = b.user_id
  LEFT JOIN public.companies bc ON bc.id = bp.company_id
  WHERE a.company_id = p_company_id
  ON CONFLICT (owner_user_id, contact_user_id) WHERE contact_user_id IS NOT NULL DO NOTHING;
END;
$$;

-- 3. Profile company change → sync + cleanup
CREATE OR REPLACE FUNCTION public.tg_profile_company_contacts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.company_id IS NOT NULL THEN
      DELETE FROM public.contacts
      WHERE source = 'auto_project'
        AND (
          (owner_user_id = OLD.user_id AND contact_user_id IN (SELECT user_id FROM public.profiles WHERE company_id = OLD.company_id))
          OR (contact_user_id = OLD.user_id AND owner_user_id IN (SELECT user_id FROM public.profiles WHERE company_id = OLD.company_id))
        );
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.company_id IS DISTINCT FROM NEW.company_id AND OLD.company_id IS NOT NULL THEN
    DELETE FROM public.contacts
    WHERE source = 'auto_project'
      AND (
        (owner_user_id = NEW.user_id AND contact_user_id IN (SELECT user_id FROM public.profiles WHERE company_id = OLD.company_id))
        OR (contact_user_id = NEW.user_id AND owner_user_id IN (SELECT user_id FROM public.profiles WHERE company_id = OLD.company_id))
      );
  END IF;

  IF NEW.company_id IS NOT NULL THEN
    PERFORM public.sync_company_contacts(NEW.company_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_profile_company_contacts_sync ON public.profiles;
CREATE TRIGGER tg_profile_company_contacts_sync
AFTER INSERT OR UPDATE OF company_id OR DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.tg_profile_company_contacts();

-- 4. Employee unlink/delete → remove auto contacts for the unlinked user in that company
CREATE OR REPLACE FUNCTION public.tg_employee_contacts_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_co uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_uid := OLD.linked_user_id;
    v_co := OLD.company_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.linked_user_id IS DISTINCT FROM NEW.linked_user_id THEN
    v_uid := OLD.linked_user_id;
    v_co := OLD.company_id;
  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_uid IS NULL OR v_co IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  -- Only clean up if the user is no longer part of that company via profiles
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_uid AND company_id = v_co) THEN
    DELETE FROM public.contacts
    WHERE source = 'auto_project'
      AND (
        (owner_user_id = v_uid AND contact_user_id IN (SELECT user_id FROM public.profiles WHERE company_id = v_co))
        OR (contact_user_id = v_uid AND owner_user_id IN (SELECT user_id FROM public.profiles WHERE company_id = v_co))
      );
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tg_employee_contacts_cleanup ON public.employees;
CREATE TRIGGER tg_employee_contacts_cleanup
AFTER UPDATE OF linked_user_id OR DELETE ON public.employees
FOR EACH ROW EXECUTE FUNCTION public.tg_employee_contacts_cleanup();

-- 5. Backfill: delete auto-added contacts where the two users don't share a company
DELETE FROM public.contacts c
WHERE c.source = 'auto_project'
  AND (
    c.contact_user_id IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM public.profiles a
      JOIN public.profiles b ON b.company_id = a.company_id
      WHERE a.user_id = c.owner_user_id AND b.user_id = c.contact_user_id
    )
  );

-- 6. Backfill: ensure every same-company pair has auto contacts
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT company_id FROM public.profiles WHERE company_id IS NOT NULL LOOP
    PERFORM public.sync_company_contacts(r.company_id);
  END LOOP;
END $$;
