-- 1. Table
CREATE TABLE public.project_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  company_id uuid NOT NULL,
  name text,
  address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, company_id)
);

CREATE INDEX idx_project_aliases_company ON public.project_aliases (company_id, project_id);
CREATE INDEX idx_project_aliases_project ON public.project_aliases (project_id);

-- 2. Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_aliases TO authenticated;
GRANT ALL ON public.project_aliases TO service_role;

-- 3. RLS
ALTER TABLE public.project_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View project aliases"
  ON public.project_aliases FOR SELECT
  USING (is_moa() OR can_view_project(project_id));

CREATE POLICY "Insert own project alias"
  ON public.project_aliases FOR INSERT
  WITH CHECK (is_moa() OR (company_id = get_user_company_id() AND can_view_project(project_id)));

CREATE POLICY "Update own project alias"
  ON public.project_aliases FOR UPDATE
  USING (is_moa() OR (company_id = get_user_company_id() AND can_view_project(project_id)));

CREATE POLICY "Delete own project alias"
  ON public.project_aliases FOR DELETE
  USING (is_moa() OR (company_id = get_user_company_id() AND can_view_project(project_id)));

-- 4. updated_at trigger
CREATE TRIGGER trg_project_aliases_updated_at
  BEFORE UPDATE ON public.project_aliases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Resolver function used by edge functions
CREATE OR REPLACE FUNCTION public.resolve_project_display(
  p_project_id uuid,
  p_company_id uuid
) RETURNS TABLE(name text, address text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(NULLIF(trim(a.name), ''), p.name) AS name,
         COALESCE(NULLIF(trim(a.address), ''), p.address) AS address
  FROM public.projects p
  LEFT JOIN public.project_aliases a
    ON a.project_id = p.id AND a.company_id = p_company_id
  WHERE p.id = p_project_id;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_project_display(uuid, uuid) TO authenticated, service_role;

-- 6. Backfill: collapse duplicate Guest GC projects onto the Sub's canonical project
DO $$
DECLARE
  r record;
  v_sub_project_id uuid;
BEGIN
  FOR r IN
    SELECT pre.*, gp.id AS guest_project_id, gp.name AS guest_project_name, gp.address AS guest_project_address,
           gp.company_id AS guest_company_id
    FROM public.gc_invite_prefills pre
    JOIN public.projects gp ON gp.id = pre.created_project_id
    WHERE pre.accepted_at IS NOT NULL
      AND pre.created_project_id IS NOT NULL
  LOOP
    -- Find the Sub's original project with the same prefill name
    SELECT id INTO v_sub_project_id
    FROM public.projects
    WHERE company_id = r.sub_company_id
      AND lower(trim(name)) = lower(trim(r.project_name))
      AND id <> r.guest_project_id
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_sub_project_id IS NULL THEN
      -- No Sub project to merge onto; leave the duplicate in place but still
      -- record the Guest GC's display values as an alias on its own project so the
      -- pattern is consistent.
      INSERT INTO public.project_aliases (project_id, company_id, name, address)
      VALUES (r.guest_project_id, r.guest_company_id, r.guest_project_name, r.guest_project_address)
      ON CONFLICT (project_id, company_id) DO NOTHING;
      CONTINUE;
    END IF;

    -- Snapshot the Guest GC's current name/address as their alias on the Sub's project
    INSERT INTO public.project_aliases (project_id, company_id, name, address)
    VALUES (v_sub_project_id, r.guest_company_id, r.guest_project_name, r.guest_project_address)
    ON CONFLICT (project_id, company_id) DO NOTHING;

    -- Re-point dependent rows from the duplicate project_id onto the Sub's project
    UPDATE public.schedule_requests SET project_id = v_sub_project_id WHERE project_id = r.guest_project_id;
    UPDATE public.tasks            SET project_id = v_sub_project_id WHERE project_id = r.guest_project_id;
    UPDATE public.availability     SET project_id = v_sub_project_id WHERE project_id = r.guest_project_id;

    -- employee_project_assignments has UNIQUE(employee_id, project_id) — re-insert with conflict skip then delete
    INSERT INTO public.employee_project_assignments (employee_id, project_id, company_id, receive_notifications)
    SELECT employee_id, v_sub_project_id, company_id, receive_notifications
    FROM public.employee_project_assignments
    WHERE project_id = r.guest_project_id
    ON CONFLICT (employee_id, project_id) DO NOTHING;
    DELETE FROM public.employee_project_assignments WHERE project_id = r.guest_project_id;

    -- user_project_assignments similarly
    INSERT INTO public.user_project_assignments (user_id, project_id, company_id, receive_notifications)
    SELECT user_id, v_sub_project_id, company_id, receive_notifications
    FROM public.user_project_assignments
    WHERE project_id = r.guest_project_id
    ON CONFLICT DO NOTHING;
    DELETE FROM public.user_project_assignments WHERE project_id = r.guest_project_id;

    -- Drop duplicate project_connections row pointing to the guest project
    DELETE FROM public.project_connections WHERE project_id = r.guest_project_id;

    -- Delete the duplicate project
    DELETE FROM public.projects WHERE id = r.guest_project_id;

    -- Update prefill pointer
    UPDATE public.gc_invite_prefills
       SET created_project_id = v_sub_project_id
     WHERE id = r.id;
  END LOOP;
END $$;