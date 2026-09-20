
-- Eligible users of a company: Foreman (level_1) and above, or users without an explicit role row
CREATE OR REPLACE FUNCTION public.contact_eligible_users(p_company_id uuid)
RETURNS TABLE(user_id uuid, full_name text, email text, phone text, company_name text, job_title text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.user_id,
         COALESCE(p.full_name, p.email) AS full_name,
         p.email,
         p.phone,
         c.name AS company_name,
         e.job_title
  FROM public.profiles p
  LEFT JOIN public.companies c ON c.id = p.company_id
  LEFT JOIN LATERAL (
    SELECT e2.job_title FROM public.employees e2
    WHERE e2.linked_user_id = p.user_id AND e2.company_id = p.company_id
    LIMIT 1
  ) e ON true
  WHERE p.company_id = p_company_id
    AND (
      EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = p.user_id
          AND (ur.company_id = p_company_id OR ur.company_id IS NULL)
          AND ur.permission_level IN ('level_1','partial','full','account_holder')
      )
      OR NOT EXISTS (
        SELECT 1 FROM public.user_roles ur2 WHERE ur2.user_id = p.user_id
      )
    );
$$;

-- Insert reciprocal contacts between two companies
CREATE OR REPLACE FUNCTION public.link_company_contacts(p_company_a uuid, p_company_b uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_company_a IS NULL OR p_company_b IS NULL OR p_company_a = p_company_b THEN RETURN; END IF;

  INSERT INTO public.contacts (owner_user_id, contact_user_id, name, job_title, company_name, phone, email, source)
  SELECT a.user_id, b.user_id, b.full_name, b.job_title, b.company_name, b.phone, b.email, 'auto_project'
  FROM public.contact_eligible_users(p_company_a) a
  CROSS JOIN public.contact_eligible_users(p_company_b) b
  WHERE a.user_id <> b.user_id
  ON CONFLICT (owner_user_id, contact_user_id) WHERE contact_user_id IS NOT NULL DO NOTHING;

  INSERT INTO public.contacts (owner_user_id, contact_user_id, name, job_title, company_name, phone, email, source)
  SELECT b.user_id, a.user_id, a.full_name, a.job_title, a.company_name, a.phone, a.email, 'auto_project'
  FROM public.contact_eligible_users(p_company_a) a
  CROSS JOIN public.contact_eligible_users(p_company_b) b
  WHERE a.user_id <> b.user_id
  ON CONFLICT (owner_user_id, contact_user_id) WHERE contact_user_id IS NOT NULL DO NOTHING;
END;
$$;

-- Cross-company contact sync for one project
CREATE OR REPLACE FUNCTION public.sync_project_cross_company_contacts(p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_owner uuid;
  v_partner uuid;
BEGIN
  IF p_project_id IS NULL THEN RETURN; END IF;
  SELECT company_id INTO v_owner FROM public.projects WHERE id = p_project_id;
  IF v_owner IS NULL THEN RETURN; END IF;

  PERFORM public.sync_company_contacts(v_owner);

  FOR v_partner IN
    SELECT sub_company_id FROM public.project_connections WHERE project_id = p_project_id
    UNION
    SELECT sub_company_id FROM public.contractor_connection_project_assignments
      WHERE project_id = p_project_id AND shared = true
    UNION
    SELECT main_company_id FROM public.contractor_connection_project_assignments
      WHERE project_id = p_project_id AND shared = true
    UNION
    SELECT CASE WHEN g.guest_company_id = v_owner THEN g.sub_company_id ELSE g.guest_company_id END
      FROM public.guest_project_connections g
      WHERE g.guest_company_id = v_owner OR g.sub_company_id = v_owner
  LOOP
    IF v_partner IS NOT NULL AND v_partner <> v_owner THEN
      PERFORM public.sync_company_contacts(v_partner);
      PERFORM public.link_company_contacts(v_owner, v_partner);
    END IF;
  END LOOP;
END;
$$;

-- Sync every project a company participates in
CREATE OR REPLACE FUNCTION public.sync_contacts_for_company_projects(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pid uuid;
BEGIN
  IF p_company_id IS NULL THEN RETURN; END IF;
  FOR v_pid IN
    SELECT id FROM public.projects WHERE company_id = p_company_id
    UNION
    SELECT project_id FROM public.project_connections WHERE sub_company_id = p_company_id
    UNION
    SELECT project_id FROM public.contractor_connection_project_assignments
      WHERE (sub_company_id = p_company_id OR main_company_id = p_company_id) AND shared = true
    UNION
    SELECT p.id FROM public.projects p
      JOIN public.guest_project_connections g
        ON (g.guest_company_id = p.company_id AND g.sub_company_id = p_company_id)
        OR (g.sub_company_id = p.company_id AND g.guest_company_id = p_company_id)
  LOOP
    PERFORM public.sync_project_cross_company_contacts(v_pid);
  END LOOP;
END;
$$;

-- Triggers on connection tables
CREATE OR REPLACE FUNCTION public.tg_sync_project_contacts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.sync_project_cross_company_contacts(NEW.project_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_sync_guest_connection_contacts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.link_company_contacts(NEW.guest_company_id, NEW.sub_company_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_sync_user_contacts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company uuid;
BEGIN
  IF TG_TABLE_NAME = 'user_roles' THEN
    v_company := NEW.company_id;
    IF v_company IS NULL THEN
      SELECT company_id INTO v_company FROM public.profiles WHERE user_id = NEW.user_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'profiles' THEN
    v_company := NEW.company_id;
  ELSE
    v_company := NEW.company_id;
  END IF;

  PERFORM public.sync_contacts_for_company_projects(v_company);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_project_connections_contacts ON public.project_connections;
CREATE TRIGGER tg_project_connections_contacts
AFTER INSERT ON public.project_connections
FOR EACH ROW EXECUTE FUNCTION public.tg_sync_project_contacts();

DROP TRIGGER IF EXISTS tg_ccpa_contacts ON public.contractor_connection_project_assignments;
CREATE TRIGGER tg_ccpa_contacts
AFTER INSERT OR UPDATE OF shared ON public.contractor_connection_project_assignments
FOR EACH ROW EXECUTE FUNCTION public.tg_sync_project_contacts();

DROP TRIGGER IF EXISTS tg_upa_contacts ON public.user_project_assignments;
CREATE TRIGGER tg_upa_contacts
AFTER INSERT ON public.user_project_assignments
FOR EACH ROW EXECUTE FUNCTION public.tg_sync_project_contacts();

DROP TRIGGER IF EXISTS tg_guest_project_connections_contacts ON public.guest_project_connections;
CREATE TRIGGER tg_guest_project_connections_contacts
AFTER INSERT ON public.guest_project_connections
FOR EACH ROW EXECUTE FUNCTION public.tg_sync_guest_connection_contacts();

DROP TRIGGER IF EXISTS tg_user_roles_contacts ON public.user_roles;
CREATE TRIGGER tg_user_roles_contacts
AFTER INSERT OR UPDATE OF permission_level ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.tg_sync_user_contacts();

DROP TRIGGER IF EXISTS tg_profiles_project_contacts ON public.profiles;
CREATE TRIGGER tg_profiles_project_contacts
AFTER INSERT OR UPDATE OF company_id ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.tg_sync_user_contacts();

-- Contacts must survive project/company disconnection: only keep cleanup for removed accounts
CREATE OR REPLACE FUNCTION public.tg_profile_company_contacts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.contacts
    WHERE owner_user_id = OLD.user_id OR contact_user_id = OLD.user_id;
    RETURN OLD;
  END IF;

  PERFORM public.sync_company_contacts(NEW.company_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_employee_contacts_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Backfill all currently connected projects
DO $$
DECLARE v_pid uuid;
BEGIN
  FOR v_pid IN SELECT id FROM public.projects LOOP
    PERFORM public.sync_project_cross_company_contacts(v_pid);
  END LOOP;
END $$;
