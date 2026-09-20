
-- Connected Contractors (sub <-> sub) core schema

CREATE TABLE public.contractor_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_a_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  company_b_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  main_company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  initiated_by_company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  initiated_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  proposed_main_company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  role_change_request JSONB,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT contractor_connections_no_self CHECK (company_a_id <> company_b_id),
  CONSTRAINT contractor_connections_pair_ordered CHECK (company_a_id < company_b_id)
);
CREATE UNIQUE INDEX contractor_connections_pair_unique
  ON public.contractor_connections (company_a_id, company_b_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contractor_connections TO authenticated;
GRANT ALL ON public.contractor_connections TO service_role;
ALTER TABLE public.contractor_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "connections_readable_by_members" ON public.contractor_connections
  FOR SELECT TO authenticated
  USING (public.is_moa() OR company_a_id = public.get_user_company_id() OR company_b_id = public.get_user_company_id());

CREATE POLICY "connections_insert_by_initiator" ON public.contractor_connections
  FOR INSERT TO authenticated
  WITH CHECK (
    initiated_by_company_id = public.get_user_company_id()
    AND (company_a_id = public.get_user_company_id() OR company_b_id = public.get_user_company_id())
    AND public.has_partial_or_higher()
  );

CREATE POLICY "connections_update_by_members" ON public.contractor_connections
  FOR UPDATE TO authenticated
  USING (company_a_id = public.get_user_company_id() OR company_b_id = public.get_user_company_id() OR public.is_moa())
  WITH CHECK (company_a_id = public.get_user_company_id() OR company_b_id = public.get_user_company_id() OR public.is_moa());

CREATE POLICY "connections_delete_by_members" ON public.contractor_connections
  FOR DELETE TO authenticated
  USING (company_a_id = public.get_user_company_id() OR company_b_id = public.get_user_company_id() OR public.is_moa());

CREATE TRIGGER trg_contractor_connections_updated_at
  BEFORE UPDATE ON public.contractor_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


CREATE OR REPLACE FUNCTION public.is_on_contractor_connection(p_connection_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.contractor_connections cc
    WHERE cc.id = p_connection_id
      AND (cc.company_a_id = public.get_user_company_id() OR cc.company_b_id = public.get_user_company_id())
  );
$$;


CREATE TABLE public.contractor_connection_project_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES public.contractor_connections(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  main_company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  sub_company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  shared BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_id, project_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contractor_connection_project_assignments TO authenticated;
GRANT ALL ON public.contractor_connection_project_assignments TO service_role;
ALTER TABLE public.contractor_connection_project_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cc_project_readable_by_members" ON public.contractor_connection_project_assignments
  FOR SELECT TO authenticated
  USING (public.is_moa() OR main_company_id = public.get_user_company_id() OR sub_company_id = public.get_user_company_id());

CREATE POLICY "cc_project_writable_by_main_full" ON public.contractor_connection_project_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    main_company_id = public.get_user_company_id()
    AND public.can_manage_projects()
    AND public.is_on_contractor_connection(connection_id)
  );

CREATE POLICY "cc_project_update_by_main_full" ON public.contractor_connection_project_assignments
  FOR UPDATE TO authenticated
  USING (main_company_id = public.get_user_company_id() AND public.can_manage_projects())
  WITH CHECK (main_company_id = public.get_user_company_id() AND public.can_manage_projects());

CREATE POLICY "cc_project_delete_by_main_full" ON public.contractor_connection_project_assignments
  FOR DELETE TO authenticated
  USING (main_company_id = public.get_user_company_id() AND public.can_manage_projects());

CREATE TRIGGER trg_cc_project_updated_at
  BEFORE UPDATE ON public.contractor_connection_project_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


CREATE TABLE public.contractor_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inviting_company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  emails TEXT[] NOT NULL DEFAULT '{}',
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','accepted','expired','cancelled')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  proposed_role TEXT CHECK (proposed_role IN ('main','sub')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contractor_invites TO authenticated;
GRANT ALL ON public.contractor_invites TO service_role;
ALTER TABLE public.contractor_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contractor_invites_own_company" ON public.contractor_invites
  FOR ALL TO authenticated
  USING (public.is_moa() OR inviting_company_id = public.get_user_company_id())
  WITH CHECK (public.is_moa() OR (inviting_company_id = public.get_user_company_id() AND public.has_partial_or_higher()));

CREATE TRIGGER trg_contractor_invites_updated_at
  BEFORE UPDATE ON public.contractor_invites
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS on_behalf_of_company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL;

ALTER TABLE public.schedule_requests
  ADD COLUMN IF NOT EXISTS acting_company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_sub_company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL;


CREATE OR REPLACE FUNCTION public.search_sub_companies_for_connection(p_query TEXT DEFAULT '')
RETURNS TABLE(id UUID, name TEXT, address TEXT, trade TEXT, is_guest BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.name, c.address, c.trade, c.is_guest
  FROM public.companies c
  WHERE c.company_type = 'sub'
    AND c.id <> public.get_user_company_id()
    AND (p_query = '' OR c.name ILIKE '%' || p_query || '%' OR c.trade ILIKE '%' || p_query || '%')
  ORDER BY c.name
  LIMIT 50;
$$;


CREATE OR REPLACE FUNCTION public.create_contractor_connection_request(
  p_other_company_id UUID,
  p_proposed_role TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me_co UUID := public.get_user_company_id();
  v_a UUID; v_b UUID; v_proposed_main UUID; v_id UUID;
BEGIN
  IF v_me_co IS NULL THEN RAISE EXCEPTION 'Not in a company'; END IF;
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
$$;

CREATE OR REPLACE FUNCTION public.respond_contractor_connection_request(
  p_connection_id UUID, p_accept BOOLEAN, p_confirm_main_company_id UUID DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conn RECORD; v_me_co UUID := public.get_user_company_id(); v_main UUID;
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
$$;

CREATE OR REPLACE FUNCTION public.request_or_confirm_role_swap(
  p_connection_id UUID, p_proposed_main_company_id UUID
) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conn RECORD; v_me_co UUID := public.get_user_company_id(); v_req JSONB; v_prev_by UUID;
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
  p_connection_id UUID, p_project_id UUID, p_shared BOOLEAN
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conn RECORD; v_me_co UUID := public.get_user_company_id(); v_sub UUID; v_owner UUID; v_id UUID;
BEGIN
  SELECT * INTO v_conn FROM public.contractor_connections WHERE id = p_connection_id;
  IF NOT FOUND OR v_conn.status <> 'accepted' THEN RAISE EXCEPTION 'Connection not active'; END IF;
  IF v_conn.main_company_id IS NULL OR v_conn.main_company_id <> v_me_co THEN
    RAISE EXCEPTION 'Only the Main Contractor can assign projects';
  END IF;
  IF NOT public.can_manage_projects() THEN RAISE EXCEPTION 'Not authorized'; END IF;

  SELECT company_id INTO v_owner FROM public.projects WHERE id = p_project_id;
  IF v_owner IS NULL OR v_owner <> v_me_co THEN RAISE EXCEPTION 'Project must belong to your company'; END IF;

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


INSERT INTO public.notification_templates (event_type, channel, subject, body_html, description, is_active, placeholder_variables)
VALUES (
  'contractor_invite',
  'email',
  '{inviting_company_name} invited you to connect on SSAA',
  '<p>Hi there,</p><p><strong>{inviting_company_name}</strong> uses SSAA (Schedule Someone Anytime Anywhere) to coordinate manpower with the contractors they work with — and they want to add <strong>{invitee_company_name}</strong> to their Connected Contractors list.</p><p>Once you accept, you''ll be able to share your team''s availability directly onto their project schedules, and they''ll be able to request your crews the same way they request their own.</p><p><a href="{invite_link}">Get started here</a></p><p>If you don''t use SSAA yet, this link will walk you through a free signup for your company.</p><p>— The SSAA Team</p>',
  'Sent when a sub invites another sub (not yet on SSAA) to become a Connected Contractor.',
  true,
  ARRAY['inviting_company_name','invitee_company_name','invite_link']
);
