
CREATE OR REPLACE FUNCTION public.resolve_acting_company(p_acting_company_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_co uuid;
BEGIN
  IF p_acting_company_id IS NOT NULL AND public.is_moa() THEN
    v_co := p_acting_company_id;
  ELSE
    v_co := public.get_user_company_id();
  END IF;
  IF v_co IS NULL THEN
    RAISE EXCEPTION 'Unable to determine your company';
  END IF;
  RETURN v_co;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_acting_company(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.request_or_confirm_role_swap(
  p_connection_id uuid,
  p_proposed_main_company_id uuid,
  p_acting_company_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conn RECORD; v_me_co UUID := public.resolve_acting_company(p_acting_company_id); v_req JSONB; v_prev_by UUID;
BEGIN
  SELECT * INTO v_conn FROM public.contractor_connections WHERE id = p_connection_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Connection not found'; END IF;
  IF v_conn.status <> 'accepted' THEN RAISE EXCEPTION 'Connection not active'; END IF;
  IF v_me_co NOT IN (v_conn.company_a_id, v_conn.company_b_id) THEN RAISE EXCEPTION 'Not a member'; END IF;
  IF p_proposed_main_company_id NOT IN (v_conn.company_a_id, v_conn.company_b_id) THEN RAISE EXCEPTION 'Invalid main company'; END IF;
  IF NOT public.has_partial_or_higher() THEN RAISE EXCEPTION 'Not authorized'; END IF;

  v_req := v_conn.role_change_request;
  v_prev_by := NULLIF(v_req->>'requested_by_company_id','')::uuid;

  IF v_prev_by IS NOT NULL AND v_prev_by <> v_me_co
     AND (v_req->>'proposed_main_company_id')::uuid = p_proposed_main_company_id THEN
    UPDATE public.contractor_connections
      SET main_company_id=p_proposed_main_company_id, role_change_request=NULL, updated_at=now()
      WHERE id = p_connection_id;
    RETURN 'confirmed';
  END IF;

  UPDATE public.contractor_connections
    SET role_change_request = jsonb_build_object(
          'proposed_main_company_id', p_proposed_main_company_id,
          'requested_by_company_id', v_me_co,
          'requested_by_user_id', auth.uid(),
          'requested_at', now()
        ),
        updated_at = now()
    WHERE id = p_connection_id;
  RETURN 'requested';
END;
$$;

CREATE OR REPLACE FUNCTION public.set_contractor_connection_project(
  p_connection_id uuid,
  p_project_id uuid,
  p_shared boolean,
  p_acting_company_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conn RECORD; v_me_co UUID := public.resolve_acting_company(p_acting_company_id); v_sub UUID; v_owner UUID; v_id UUID; v_allowed BOOLEAN;
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

CREATE OR REPLACE FUNCTION public.unset_contractor_connection_project(
  p_connection_id uuid,
  p_project_id uuid,
  p_acting_company_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conn RECORD; v_me_co UUID := public.resolve_acting_company(p_acting_company_id);
BEGIN
  SELECT * INTO v_conn FROM public.contractor_connections WHERE id = p_connection_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Connection not found'; END IF;
  IF v_conn.main_company_id IS NULL OR v_conn.main_company_id <> v_me_co THEN
    RAISE EXCEPTION 'Only the Main Contractor can change project assignments';
  END IF;
  IF NOT public.can_manage_projects() THEN RAISE EXCEPTION 'Not authorized'; END IF;

  DELETE FROM public.contractor_connection_project_assignments
   WHERE connection_id = p_connection_id AND project_id = p_project_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unset_contractor_connection_project(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_contractor_connection_project(uuid, uuid, boolean, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_or_confirm_role_swap(uuid, uuid, uuid) TO authenticated, service_role;

UPDATE public.contractor_connections
   SET role_change_request = NULL, updated_at = now()
 WHERE role_change_request IS NOT NULL
   AND NULLIF(role_change_request->>'requested_by_company_id','') IS NULL;
