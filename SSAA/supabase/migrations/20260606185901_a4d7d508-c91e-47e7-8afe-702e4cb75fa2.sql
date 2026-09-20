
-- =========================================================
-- MESSAGING SYSTEM
-- =========================================================

CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('project','dm','group')),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  title text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;

CREATE TABLE public.conversation_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  company_id uuid,
  role text NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, user_id)
);
CREATE INDEX idx_conv_participants_user ON public.conversation_participants(user_id);
CREATE INDEX idx_conv_participants_conv ON public.conversation_participants(conversation_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_participants TO authenticated;
GRANT ALL ON public.conversation_participants TO service_role;

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_user_id uuid,
  sender_company_id uuid,
  body text,
  kind text NOT NULL DEFAULT 'user'
    CHECK (kind IN ('user','system_schedule_request','system_schedule_edit','system_schedule_reject','system_schedule_cancel','system_schedule_confirm','system_participant_added')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_conv_created ON public.messages(conversation_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;

CREATE TABLE public.message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  mime_type text,
  size_bytes integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_msg_attachments_msg ON public.message_attachments(message_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_attachments TO authenticated;
GRANT ALL ON public.message_attachments TO service_role;

CREATE TABLE public.message_reads (
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_reads TO authenticated;
GRANT ALL ON public.message_reads TO service_role;

CREATE TABLE public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  contact_user_id uuid,
  name text NOT NULL,
  job_title text,
  company_name text,
  phone text,
  email text,
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','auto_project','ssaa_link')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_contacts_owner_user ON public.contacts(owner_user_id, contact_user_id) WHERE contact_user_id IS NOT NULL;
CREATE INDEX idx_contacts_owner ON public.contacts(owner_user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;
GRANT ALL ON public.contacts TO service_role;

-- =========================================================
-- HELPERS
-- =========================================================
CREATE OR REPLACE FUNCTION public.is_conversation_participant(p_conv_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_participants
    WHERE conversation_id = p_conv_id AND user_id = auth.uid()
  )
$$;

CREATE OR REPLACE FUNCTION public.can_post_in_project_conversation(p_conv_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_project_id uuid;
  v_my_company_id uuid;
  v_my_company_type company_type;
  v_my_level permission_level;
BEGIN
  IF is_moa() THEN RETURN true; END IF;
  IF NOT is_conversation_participant(p_conv_id) THEN RETURN false; END IF;
  SELECT c.project_id INTO v_project_id FROM public.conversations c WHERE c.id = p_conv_id;
  IF v_project_id IS NULL THEN RETURN true; END IF;
  v_my_company_id := get_user_company_id();
  SELECT company_type INTO v_my_company_type FROM public.companies WHERE id = v_my_company_id;
  v_my_level := get_user_permission_level();
  IF v_my_company_type = 'sub' THEN
    RETURN v_my_level NOT IN ('basic','level_1');
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_project_conversation_participants(p_project_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conv_id uuid;
  v_owner_company uuid;
BEGIN
  SELECT id INTO v_conv_id FROM public.conversations WHERE project_id = p_project_id;
  IF v_conv_id IS NULL THEN RETURN; END IF;
  SELECT company_id INTO v_owner_company FROM public.projects WHERE id = p_project_id;

  INSERT INTO public.conversation_participants (conversation_id, user_id, company_id)
  SELECT v_conv_id, p.user_id, p.company_id
  FROM public.profiles p
  WHERE p.company_id = v_owner_company
  ON CONFLICT DO NOTHING;

  INSERT INTO public.conversation_participants (conversation_id, user_id, company_id)
  SELECT v_conv_id, p.user_id, p.company_id
  FROM public.project_connections pc
  JOIN public.profiles p ON p.company_id = pc.sub_company_id
  WHERE pc.project_id = p_project_id
  ON CONFLICT DO NOTHING;

  INSERT INTO public.conversation_participants (conversation_id, user_id, company_id)
  SELECT v_conv_id, p.user_id, p.company_id
  FROM public.guest_project_connections gpc
  JOIN public.profiles p ON p.company_id = gpc.guest_company_id
  WHERE gpc.sub_company_id = v_owner_company
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_or_create_project_conversation(p_project_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_name text;
BEGIN
  SELECT id INTO v_id FROM public.conversations WHERE project_id = p_project_id;
  IF v_id IS NOT NULL THEN
    PERFORM sync_project_conversation_participants(p_project_id);
    RETURN v_id;
  END IF;
  SELECT name INTO v_name FROM public.projects WHERE id = p_project_id;
  INSERT INTO public.conversations (type, project_id, title, created_by)
  VALUES ('project', p_project_id, v_name, auth.uid())
  RETURNING id INTO v_id;
  PERFORM sync_project_conversation_participants(p_project_id);
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_or_create_dm_conversation(p_other_user_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_me uuid := auth.uid();
  v_my_co uuid;
  v_other_co uuid;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF v_me = p_other_user_id THEN RAISE EXCEPTION 'cannot DM yourself'; END IF;
  SELECT c.id INTO v_id
  FROM public.conversations c
  WHERE c.type = 'dm'
    AND EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id = c.id AND user_id = v_me)
    AND EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id = c.id AND user_id = p_other_user_id)
    AND (SELECT count(*) FROM public.conversation_participants WHERE conversation_id = c.id) = 2
  LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  v_my_co := get_user_company_id();
  SELECT company_id INTO v_other_co FROM public.profiles WHERE user_id = p_other_user_id;
  INSERT INTO public.conversations (type, created_by) VALUES ('dm', v_me) RETURNING id INTO v_id;
  INSERT INTO public.conversation_participants (conversation_id, user_id, company_id) VALUES
    (v_id, v_me, v_my_co),
    (v_id, p_other_user_id, v_other_co);
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_group_conversation(p_title text, p_user_ids uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_me uuid := auth.uid();
  v_uid uuid;
  v_co uuid;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  INSERT INTO public.conversations (type, title, created_by) VALUES ('group', p_title, v_me) RETURNING id INTO v_id;
  INSERT INTO public.conversation_participants (conversation_id, user_id, company_id)
  VALUES (v_id, v_me, get_user_company_id());
  FOREACH v_uid IN ARRAY p_user_ids LOOP
    IF v_uid IS NOT NULL AND v_uid <> v_me THEN
      SELECT company_id INTO v_co FROM public.profiles WHERE user_id = v_uid;
      INSERT INTO public.conversation_participants (conversation_id, user_id, company_id)
      VALUES (v_id, v_uid, v_co)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  RETURN v_id;
END;
$$;

-- Search SSAA users for adding contacts
CREATE OR REPLACE FUNCTION public.search_ssaa_users(p_query text)
RETURNS TABLE(user_id uuid, full_name text, email text, phone text, company_name text, company_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.user_id, p.full_name, p.email, p.phone, c.name, p.company_id
  FROM public.profiles p
  LEFT JOIN public.companies c ON c.id = p.company_id
  WHERE p.user_id <> auth.uid()
    AND (
      p.email ILIKE '%' || p_query || '%'
      OR p.full_name ILIKE '%' || p_query || '%'
      OR p.phone ILIKE '%' || p_query || '%'
    )
  LIMIT 25
$$;

-- Auto-add contacts for connected users on a project
CREATE OR REPLACE FUNCTION public.sync_contacts_for_project(p_project_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owner_company uuid;
BEGIN
  SELECT company_id INTO v_owner_company FROM public.projects WHERE id = p_project_id;
  WITH related_users AS (
    SELECT user_id, company_id FROM public.profiles WHERE company_id = v_owner_company
    UNION
    SELECT p.user_id, p.company_id
      FROM public.project_connections pc
      JOIN public.profiles p ON p.company_id = pc.sub_company_id
      WHERE pc.project_id = p_project_id
    UNION
    SELECT p.user_id, p.company_id
      FROM public.guest_project_connections gpc
      JOIN public.profiles p ON p.company_id = gpc.guest_company_id
      WHERE gpc.sub_company_id = v_owner_company
  )
  INSERT INTO public.contacts (owner_user_id, contact_user_id, name, company_name, phone, email, source)
  SELECT a.user_id, b.user_id,
         COALESCE(bp.full_name, bp.email),
         bc.name, bp.phone, bp.email, 'auto_project'
  FROM related_users a
  JOIN related_users b ON b.user_id <> a.user_id
  JOIN public.profiles bp ON bp.user_id = b.user_id
  LEFT JOIN public.companies bc ON bc.id = bp.company_id
  ON CONFLICT (owner_user_id, contact_user_id) DO NOTHING;
END;
$$;

-- =========================================================
-- RLS
-- =========================================================
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View conversations" ON public.conversations FOR SELECT TO authenticated
  USING (is_moa() OR is_conversation_participant(id));
CREATE POLICY "Insert conversations" ON public.conversations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Update conversations" ON public.conversations FOR UPDATE TO authenticated
  USING (is_moa() OR is_conversation_participant(id));
CREATE POLICY "Delete conversations MOA" ON public.conversations FOR DELETE TO authenticated
  USING (is_moa());

CREATE POLICY "View participants" ON public.conversation_participants FOR SELECT TO authenticated
  USING (is_moa() OR user_id = auth.uid() OR is_conversation_participant(conversation_id));
CREATE POLICY "Insert participants" ON public.conversation_participants FOR INSERT TO authenticated
  WITH CHECK (is_moa() OR is_conversation_participant(conversation_id) OR user_id = auth.uid());
CREATE POLICY "Delete participants" ON public.conversation_participants FOR DELETE TO authenticated
  USING (is_moa() OR user_id = auth.uid());

CREATE POLICY "View messages" ON public.messages FOR SELECT TO authenticated
  USING (is_moa() OR is_conversation_participant(conversation_id));
CREATE POLICY "Insert messages" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_user_id = auth.uid()
    AND is_conversation_participant(conversation_id)
    AND (
      (SELECT type FROM public.conversations WHERE id = conversation_id) <> 'project'
      OR can_post_in_project_conversation(conversation_id)
    )
  );
CREATE POLICY "Update own messages" ON public.messages FOR UPDATE TO authenticated
  USING (sender_user_id = auth.uid() OR is_moa());
CREATE POLICY "Delete own messages" ON public.messages FOR DELETE TO authenticated
  USING (sender_user_id = auth.uid() OR is_moa());

CREATE POLICY "View attachments" ON public.message_attachments FOR SELECT TO authenticated
  USING (is_moa() OR EXISTS (
    SELECT 1 FROM public.messages m WHERE m.id = message_id AND is_conversation_participant(m.conversation_id)
  ));
CREATE POLICY "Insert attachments" ON public.message_attachments FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_id AND m.sender_user_id = auth.uid()));
CREATE POLICY "Delete attachments" ON public.message_attachments FOR DELETE TO authenticated
  USING (is_moa() OR EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_id AND m.sender_user_id = auth.uid()));

CREATE POLICY "Manage own reads" ON public.message_reads FOR ALL TO authenticated
  USING (user_id = auth.uid() OR is_moa())
  WITH CHECK (user_id = auth.uid() OR is_moa());

CREATE POLICY "Manage own contacts" ON public.contacts FOR ALL TO authenticated
  USING (owner_user_id = auth.uid() OR is_moa())
  WITH CHECK (owner_user_id = auth.uid() OR is_moa());

-- =========================================================
-- TRIGGERS
-- =========================================================
CREATE OR REPLACE FUNCTION public.touch_conversation_last_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.conversations SET last_message_at = NEW.created_at WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_messages_touch_conv
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_conversation_last_message();

CREATE OR REPLACE FUNCTION public.emit_schedule_request_system_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conv_id uuid;
  v_kind text;
  v_meta jsonb;
  v_target record;
BEGIN
  v_target := COALESCE(NEW, OLD);
  IF v_target.project_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  v_conv_id := get_or_create_project_conversation(v_target.project_id);

  IF TG_OP = 'INSERT' THEN
    v_kind := 'system_schedule_request';
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'confirmed' AND OLD.status IS DISTINCT FROM 'confirmed' THEN
      v_kind := 'system_schedule_confirm';
    ELSIF NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected' THEN
      v_kind := 'system_schedule_reject';
    ELSIF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
      v_kind := 'system_schedule_cancel';
    ELSIF NEW.edited = true AND COALESCE(OLD.edited,false) = false THEN
      v_kind := 'system_schedule_edit';
    ELSE
      RETURN NEW;
    END IF;
  ELSE
    RETURN OLD;
  END IF;

  v_meta := jsonb_build_object(
    'schedule_request_id', v_target.id,
    'scheduled_date', v_target.scheduled_date,
    'start_time', v_target.start_time,
    'end_time', v_target.end_time,
    'employee_ids', v_target.employee_ids,
    'image_urls', v_target.image_urls,
    'description', v_target.description,
    'cancellation_reason', v_target.cancellation_reason,
    'requesting_company_id', v_target.requesting_company_id,
    'sub_company_id', v_target.sub_company_id,
    'status', v_target.status
  );

  INSERT INTO public.messages (conversation_id, sender_user_id, sender_company_id, body, kind, metadata)
  VALUES (v_conv_id, NULL, v_target.requesting_company_id, NULL, v_kind, v_meta);
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER trg_schedule_requests_chat_emit
  AFTER INSERT OR UPDATE ON public.schedule_requests
  FOR EACH ROW EXECUTE FUNCTION public.emit_schedule_request_system_message();

CREATE OR REPLACE FUNCTION public.tg_sync_project_chat_on_conn_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_proj uuid;
BEGIN
  v_proj := COALESCE(NEW.project_id, OLD.project_id);
  PERFORM sync_project_conversation_participants(v_proj);
  PERFORM sync_contacts_for_project(v_proj);
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER trg_project_connections_chat_sync
  AFTER INSERT OR DELETE ON public.project_connections
  FOR EACH ROW EXECUTE FUNCTION public.tg_sync_project_chat_on_conn_change();
CREATE TRIGGER trg_user_project_assignments_chat_sync
  AFTER INSERT OR DELETE ON public.user_project_assignments
  FOR EACH ROW EXECUTE FUNCTION public.tg_sync_project_chat_on_conn_change();

-- =========================================================
-- REALTIME
-- =========================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_participants;

-- =========================================================
-- STORAGE POLICIES
-- =========================================================
CREATE POLICY "Upload own message attachments"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'message-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Read message attachments"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'message-attachments');
CREATE POLICY "Delete own message attachments"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'message-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);
