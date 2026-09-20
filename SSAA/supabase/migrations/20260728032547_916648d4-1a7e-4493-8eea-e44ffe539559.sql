CREATE OR REPLACE FUNCTION public.set_contractor_connection_project(p_connection_id uuid, p_project_id uuid, p_shared boolean)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conn RECORD; v_me_co UUID := public.get_user_company_id(); v_sub UUID; v_owner UUID; v_id UUID; v_allowed BOOLEAN;
BEGIN
  SELECT * INTO v_conn FROM public.contractor_connections WHERE id = p_connection_id;
  IF NOT FOUND OR v_conn.status <> 'accepted' THEN RAISE EXCEPTION 'Connection not active'; END IF;
  IF v_conn.main_company_id IS NULL OR v_conn.main_company_id <> v_me_co THEN
    RAISE EXCEPTION 'Only the Main Contractor can assign projects';
  END IF;
  IF NOT public.can_manage_projects() THEN RAISE EXCEPTION 'Not authorized'; END IF;

  SELECT company_id INTO v_owner FROM public.projects WHERE id = p_project_id;

  v_allowed := (v_owner IS NOT NULL AND v_owner = v_me_co)
    OR EXISTS (SELECT 1 FROM public.project_connections pc
               WHERE pc.project_id = p_project_id AND pc.sub_company_id = v_me_co);

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Project must belong to your company or be connected to it';
  END IF;

  v_sub := CASE WHEN v_conn.company_a_id = v_me_co THEN v_conn.company_b_id ELSE v_conn.company_a_id END;

  INSERT INTO public.contractor_connection_project_assignments
    (connection_id, project_id, main_company_id, sub_company_id, shared, created_by)
  VALUES (p_connection_id, p_project_id, v_me_co, v_sub, p_shared, auth.uid())
  ON CONFLICT (connection_id, project_id) DO UPDATE
    SET shared = EXCLUDED.shared, updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;