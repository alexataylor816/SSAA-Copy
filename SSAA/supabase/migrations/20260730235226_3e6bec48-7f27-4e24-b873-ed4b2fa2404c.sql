
CREATE OR REPLACE FUNCTION public.get_contractor_connection_project_links(p_acting_company_id uuid DEFAULT NULL)
RETURNS TABLE(project_id uuid, sub_company_id uuid, owner_company_id uuid)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_me uuid := public.resolve_acting_company(p_acting_company_id);
BEGIN
  RETURN QUERY
  SELECT pc.project_id, pc.sub_company_id, p.company_id
  FROM public.project_connections pc
  JOIN public.projects p ON p.id = pc.project_id
  WHERE pc.sub_company_id = v_me
     OR p.company_id = v_me
     OR pc.sub_company_id IN (
        SELECT CASE WHEN cc.company_a_id = v_me THEN cc.company_b_id ELSE cc.company_a_id END
        FROM public.contractor_connections cc
        WHERE cc.status = 'accepted' AND (cc.company_a_id = v_me OR cc.company_b_id = v_me)
     )
     OR p.company_id IN (
        SELECT CASE WHEN cc.company_a_id = v_me THEN cc.company_b_id ELSE cc.company_a_id END
        FROM public.contractor_connections cc
        WHERE cc.status = 'accepted' AND (cc.company_a_id = v_me OR cc.company_b_id = v_me)
     );
END;
$$;

CREATE OR REPLACE FUNCTION public.link_contractor_connection_projects(
  p_connection_id uuid,
  p_code text,
  p_acting_company_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_me uuid := public.resolve_acting_company(p_acting_company_id);
  v_conn RECORD;
  v_other uuid;
  v_proj RECORD;
  v_sub uuid;
BEGIN
  SELECT * INTO v_conn FROM public.contractor_connections WHERE id = p_connection_id;
  IF NOT FOUND OR v_conn.status <> 'accepted' THEN
    RAISE EXCEPTION 'Connection not active';
  END IF;
  IF v_conn.company_a_id <> v_me AND v_conn.company_b_id <> v_me THEN
    RAISE EXCEPTION 'Not authorized for this connection';
  END IF;

  v_other := CASE WHEN v_conn.company_a_id = v_me THEN v_conn.company_b_id ELSE v_conn.company_a_id END;

  SELECT id, name, company_id INTO v_proj
  FROM public.projects
  WHERE connection_code = btrim(p_code)
  LIMIT 1;

  IF v_proj.id IS NULL THEN
    RAISE EXCEPTION 'Invalid connection code';
  END IF;

  IF v_proj.company_id = v_other THEN
    v_sub := v_me;
  ELSIF v_proj.company_id = v_me THEN
    v_sub := v_other;
  ELSE
    RAISE EXCEPTION 'That code belongs to a project outside this connection';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.project_connections
    WHERE project_id = v_proj.id AND sub_company_id = v_sub
  ) THEN
    RETURN jsonb_build_object('status', 'exists', 'project_id', v_proj.id, 'project_name', v_proj.name);
  END IF;

  INSERT INTO public.project_connections (project_id, sub_company_id)
  VALUES (v_proj.id, v_sub);

  RETURN jsonb_build_object('status', 'linked', 'project_id', v_proj.id, 'project_name', v_proj.name);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_contractor_connection_project_links(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_contractor_connection_projects(uuid, text, uuid) TO authenticated;
