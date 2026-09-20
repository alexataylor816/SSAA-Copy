DROP FUNCTION IF EXISTS public.create_contractor_connection_request(uuid, text);
DROP FUNCTION IF EXISTS public.respond_contractor_connection_request(uuid, boolean, uuid);

CREATE OR REPLACE FUNCTION public.create_contractor_connection_request(p_other_company_id uuid, p_proposed_role text, p_acting_company_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me_co UUID := public.resolve_acting_company(p_acting_company_id);
  v_a UUID; v_b UUID; v_proposed_main UUID; v_id UUID;
BEGIN
  IF NOT public.has_partial_or_higher() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_other_company_id = v_me_co THEN RAISE EXCEPTION 'Cannot connect to self'; END IF;
  IF p_proposed_role NOT IN ('main','sub') THEN RAISE EXCEPTION 'Invalid role'; END IF;

  IF v_me_co < p_other_company_id THEN v_a := v_me_co; v_b := p_other_company_id;
  ELSE v_a := p_other_company_id; v_b := v_me_co; END IF;

  v_proposed_main := CASE WHEN p_proposed_role = 'main' THEN v_me_co ELSE p_other_company_id END;

  INSERT INTO public.contractor_connections
    (company_a_id, company_b_id, status, initiated_by_company_id, initiated_by_user_id, proposed_main_company_id)
  VALUES (v_a, v_b, 'pending', v_me_co, auth.uid(), v_proposed_main)
  ON CONFLICT (company_a_id, company_b_id) DO UPDATE
    SET status = 'pending',
        initiated_by_company_id = EXCLUDED.initiated_by_company_id,
        initiated_by_user_id = EXCLUDED.initiated_by_user_id,
        proposed_main_company_id = EXCLUDED.proposed_main_company_id,
        updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.respond_contractor_connection_request(p_connection_id uuid, p_accept boolean, p_confirm_main_company_id uuid DEFAULT NULL, p_acting_company_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_conn RECORD; v_me_co UUID := public.resolve_acting_company(p_acting_company_id); v_main UUID;
BEGIN
  SELECT * INTO v_conn FROM public.contractor_connections WHERE id = p_connection_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Connection not found'; END IF;
  IF v_conn.status <> 'pending' THEN RAISE EXCEPTION 'Connection is not pending'; END IF;
  IF v_me_co NOT IN (v_conn.company_a_id, v_conn.company_b_id) THEN RAISE EXCEPTION 'Not a member'; END IF;
  IF v_me_co = v_conn.initiated_by_company_id THEN RAISE EXCEPTION 'The initiating company cannot accept its own request'; END IF;
  IF NOT public.has_partial_or_higher() THEN RAISE EXCEPTION 'Not authorized'; END IF;

  IF NOT p_accept THEN
    UPDATE public.contractor_connections SET status='declined', updated_at=now() WHERE id=p_connection_id;
    RETURN;
  END IF;

  v_main := COALESCE(p_confirm_main_company_id, v_conn.proposed_main_company_id);
  IF v_main NOT IN (v_conn.company_a_id, v_conn.company_b_id) THEN RAISE EXCEPTION 'Invalid main company'; END IF;

  UPDATE public.contractor_connections
    SET status='accepted', main_company_id=v_main, accepted_at=now(),
        proposed_main_company_id=NULL, role_change_request=NULL, updated_at=now()
    WHERE id = p_connection_id;
END;
$function$;