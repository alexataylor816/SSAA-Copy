-- 1. Schema: per-(project, counterpart company) conversations
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS sub_company_id uuid;
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_project_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_project_sub
  ON public.conversations(project_id, sub_company_id)
  WHERE project_id IS NOT NULL AND sub_company_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_project_legacy
  ON public.conversations(project_id)
  WHERE project_id IS NOT NULL AND sub_company_id IS NULL;

-- 2. Participants sync for a single per-sub conversation
CREATE OR REPLACE FUNCTION public.sync_project_sub_conversation_participants(p_conv_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_project_id uuid;
  v_sub_company_id uuid;
  v_owner_company uuid;
BEGIN
  SELECT project_id, sub_company_id INTO v_project_id, v_sub_company_id
    FROM public.conversations WHERE id = p_conv_id;
  IF v_project_id IS NULL OR v_sub_company_id IS NULL THEN RETURN; END IF;
  SELECT company_id INTO v_owner_company FROM public.projects WHERE id = v_project_id;

  INSERT INTO public.conversation_participants (conversation_id, user_id, company_id)
  SELECT p_conv_id, p.user_id, p.company_id
  FROM public.profiles p
  WHERE p.company_id IN (v_owner_company, v_sub_company_id)
    AND p.company_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- Remove anyone who no longer belongs to either side
  DELETE FROM public.conversation_participants cp
  USING public.profiles p
  WHERE cp.conversation_id = p_conv_id
    AND p.user_id = cp.user_id
    AND (p.company_id IS NULL OR p.company_id NOT IN (v_owner_company, v_sub_company_id));
END;
$$;

-- 3. Get-or-create a chat for (project, counterpart company)
CREATE OR REPLACE FUNCTION public.get_or_create_project_sub_conversation(
  p_project_id uuid,
  p_sub_company_id uuid
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_name text;
  v_sub_name text;
BEGIN
  IF p_project_id IS NULL OR p_sub_company_id IS NULL THEN RETURN NULL; END IF;

  SELECT id INTO v_id FROM public.conversations
   WHERE project_id = p_project_id AND sub_company_id = p_sub_company_id;

  IF v_id IS NULL THEN
    SELECT name INTO v_name FROM public.projects WHERE id = p_project_id;
    SELECT name INTO v_sub_name FROM public.companies WHERE id = p_sub_company_id;
    INSERT INTO public.conversations (type, project_id, sub_company_id, title, created_by)
    VALUES ('project', p_project_id, p_sub_company_id,
            COALESCE(v_name, 'Project') || ' — ' || COALESCE(v_sub_name, 'Subcontractor'),
            auth.uid())
    RETURNING id INTO v_id;
  END IF;

  PERFORM sync_project_sub_conversation_participants(v_id);
  RETURN v_id;
END;
$$;

-- 4. Legacy sync now only refreshes per-sub conversations of the project
CREATE OR REPLACE FUNCTION public.sync_project_conversation_participants(p_project_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.conversations
            WHERE project_id = p_project_id AND sub_company_id IS NOT NULL
  LOOP
    PERFORM sync_project_sub_conversation_participants(r.id);
  END LOOP;
END;
$$;

-- 5. Posting permission: subs blocked only at 'basic'
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
    RETURN v_my_level <> 'basic';
  END IF;
  RETURN true;
END;
$$;

-- 6. Route schedule-request system messages to the right sub chat
CREATE OR REPLACE FUNCTION public.emit_schedule_request_system_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conv_id uuid;
  v_kind text;
  v_meta jsonb;
  v_target record;
  v_personnel jsonb;
  v_dates date[];
  v_emp_ids uuid[];
  v_date_key text;
  v_target_sub_company_id uuid;
  v_target_sub_name text;
  v_on_behalf uuid;
  v_owner_company uuid;
  v_counterpart uuid;
BEGIN
  v_target := COALESCE(NEW, OLD);
  IF v_target.project_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_target.request_group_id IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.schedule_requests
        WHERE request_group_id = v_target.request_group_id
          AND id <> v_target.id
      ) THEN
        RETURN NEW;
      END IF;
    END IF;
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

  IF TG_OP = 'UPDATE' AND v_target.request_group_id IS NOT NULL THEN
    IF v_kind = 'system_schedule_confirm' THEN
      SELECT array_agg(DISTINCT scheduled_date ORDER BY scheduled_date) INTO v_dates
        FROM public.schedule_requests
        WHERE request_group_id = v_target.request_group_id
          AND status = 'confirmed'
          AND updated_at >= now() - interval '30 seconds';
    ELSIF v_kind = 'system_schedule_edit' THEN
      SELECT array_agg(DISTINCT scheduled_date ORDER BY scheduled_date) INTO v_dates
        FROM public.schedule_requests
        WHERE request_group_id = v_target.request_group_id
          AND edited = true
          AND last_edited_by_company_id IS NOT DISTINCT FROM v_target.last_edited_by_company_id
          AND updated_at >= now() - interval '30 seconds';
    ELSIF v_kind = 'system_schedule_reject' THEN
      SELECT array_agg(DISTINCT scheduled_date ORDER BY scheduled_date) INTO v_dates
        FROM public.schedule_requests
        WHERE request_group_id = v_target.request_group_id
          AND status = 'rejected'
          AND updated_at >= now() - interval '30 seconds';
    ELSIF v_kind = 'system_schedule_cancel' THEN
      SELECT array_agg(DISTINCT scheduled_date ORDER BY scheduled_date) INTO v_dates
        FROM public.schedule_requests
        WHERE request_group_id = v_target.request_group_id
          AND status = 'cancelled'
          AND updated_at >= now() - interval '30 seconds';
    END IF;
  END IF;

  IF v_dates IS NULL OR array_length(v_dates, 1) IS NULL THEN
    IF v_target.scheduled_dates IS NOT NULL AND array_length(v_target.scheduled_dates, 1) > 0 THEN
      v_dates := v_target.scheduled_dates;
    ELSIF TG_OP = 'INSERT' AND v_target.request_group_id IS NOT NULL THEN
      SELECT array_agg(DISTINCT scheduled_date ORDER BY scheduled_date) INTO v_dates
        FROM public.schedule_requests
        WHERE request_group_id = v_target.request_group_id;
    ELSE
      v_dates := ARRAY[v_target.scheduled_date];
    END IF;
  END IF;

  v_date_key := COALESCE((
    SELECT string_agg(d::text, ',' ORDER BY d) FROM unnest(v_dates) AS d
  ), '');

  IF TG_OP = 'UPDATE' AND v_target.request_group_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.kind = v_kind
        AND (m.metadata->>'request_group_id')::uuid = v_target.request_group_id
        AND COALESCE(m.metadata->>'date_key', '') = v_date_key
        AND m.created_at > now() - interval '1 minute'
    ) THEN
      RETURN NEW;
    END IF;
  END IF;

  v_emp_ids := v_target.employee_ids;

  v_target_sub_company_id := v_target.target_sub_company_id;
  IF v_target_sub_company_id IS NULL AND v_emp_ids IS NOT NULL AND array_length(v_emp_ids, 1) > 0 THEN
    SELECT e.company_id INTO v_target_sub_company_id
      FROM public.employees e
      WHERE e.id = ANY(v_emp_ids)
        AND e.company_id IS NOT NULL
        AND e.company_id <> COALESCE(v_target.acting_company_id, v_target.requesting_company_id, v_target.sub_company_id)
      LIMIT 1;
  END IF;

  IF v_target_sub_company_id IS NOT NULL THEN
    SELECT name INTO v_target_sub_name FROM public.companies WHERE id = v_target_sub_company_id;
  END IF;

  v_on_behalf := v_target_sub_company_id;

  -- Pick the counterpart company for this project's chat: the company on the
  -- opposite side of the project owner.
  SELECT company_id INTO v_owner_company FROM public.projects WHERE id = v_target.project_id;
  v_counterpart := NULL;
  FOR v_counterpart IN
    SELECT x FROM unnest(ARRAY[
      v_target.sub_company_id,
      v_target_sub_company_id,
      v_target.acting_company_id,
      v_target.requesting_company_id
    ]) AS x
    WHERE x IS NOT NULL AND x IS DISTINCT FROM v_owner_company
    LIMIT 1
  LOOP
    EXIT;
  END LOOP;

  IF v_counterpart IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_conv_id := get_or_create_project_sub_conversation(v_target.project_id, v_counterpart);
  IF v_conv_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  IF v_emp_ids IS NOT NULL AND array_length(v_emp_ids, 1) > 0 THEN
    SELECT jsonb_agg(jsonb_build_object(
      'name', e.name,
      'job_title', e.job_title,
      'company_id', e.company_id,
      'company_name', c.name,
      'times', to_char(v_target.start_time, 'FMHH12:MI AM') || ' - ' || to_char(v_target.end_time, 'FMHH12:MI AM')
    ))
    INTO v_personnel
    FROM public.employees e
    LEFT JOIN public.companies c ON c.id = e.company_id
    WHERE e.id = ANY(v_emp_ids);
  END IF;

  v_meta := jsonb_build_object(
    'schedule_request_id', v_target.id,
    'request_group_id', v_target.request_group_id,
    'scheduled_date', v_target.scheduled_date,
    'scheduled_dates', to_jsonb(v_dates),
    'date_key', v_date_key,
    'start_time', to_char(v_target.start_time, 'FMHH12:MI AM'),
    'end_time', to_char(v_target.end_time, 'FMHH12:MI AM'),
    'employee_ids', v_emp_ids,
    'personnel', COALESCE(v_personnel, '[]'::jsonb),
    'image_urls', v_target.image_urls,
    'description', v_target.description,
    'cancellation_reason', v_target.cancellation_reason,
    'requesting_company_id', v_target.requesting_company_id,
    'sub_company_id', v_target.sub_company_id,
    'acting_company_id', v_target.acting_company_id,
    'target_sub_company_id', v_target_sub_company_id,
    'target_sub_company_name', v_target_sub_name,
    'last_edited_by_company_id', v_target.last_edited_by_company_id,
    'status', v_target.status
  );

  INSERT INTO public.messages (conversation_id, sender_user_id, sender_company_id, on_behalf_of_company_id, body, kind, metadata)
  VALUES (v_conv_id, NULL, v_target.requesting_company_id, v_on_behalf, NULL, v_kind, v_meta);
  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- 7. Backfill: create per-sub chats and move attributable history into them
DO $$
DECLARE
  c record;
  m record;
  v_owner uuid;
  v_counter uuid;
  v_target uuid;
BEGIN
  FOR c IN SELECT * FROM public.conversations WHERE type = 'project' AND sub_company_id IS NULL LOOP
    SELECT company_id INTO v_owner FROM public.projects WHERE id = c.project_id;

    -- Pre-create chats for every currently connected counterpart company
    INSERT INTO public.conversations (type, project_id, sub_company_id, title, created_by)
    SELECT 'project', c.project_id, x.company_id,
           COALESCE((SELECT name FROM public.projects WHERE id = c.project_id), 'Project')
             || ' — ' || COALESCE((SELECT name FROM public.companies WHERE id = x.company_id), 'Company'),
           c.created_by
    FROM (
      SELECT pc.sub_company_id AS company_id
        FROM public.project_connections pc WHERE pc.project_id = c.project_id
      UNION
      SELECT gpc.guest_company_id
        FROM public.guest_project_connections gpc
        JOIN public.project_aliases pa
          ON pa.project_id = c.project_id AND pa.company_id = gpc.guest_company_id
       WHERE gpc.sub_company_id = v_owner
    ) x
    WHERE x.company_id IS NOT NULL AND x.company_id IS DISTINCT FROM v_owner
      AND NOT EXISTS (
        SELECT 1 FROM public.conversations c2
         WHERE c2.project_id = c.project_id AND c2.sub_company_id = x.company_id
      );

    -- Move attributable messages
    FOR m IN SELECT * FROM public.messages WHERE conversation_id = c.id LOOP
      v_counter := NULL;
      SELECT x INTO v_counter FROM unnest(ARRAY[
        NULLIF(m.metadata->>'sub_company_id','')::uuid,
        NULLIF(m.metadata->>'target_sub_company_id','')::uuid,
        NULLIF(m.metadata->>'acting_company_id','')::uuid,
        NULLIF(m.metadata->>'requesting_company_id','')::uuid,
        CASE WHEN m.kind = 'user' THEN m.sender_company_id ELSE NULL END
      ]) AS x
      WHERE x IS NOT NULL AND x IS DISTINCT FROM v_owner
      LIMIT 1;

      IF v_counter IS NOT NULL THEN
        SELECT id INTO v_target FROM public.conversations
         WHERE project_id = c.project_id AND sub_company_id = v_counter;
        IF v_target IS NULL THEN
          INSERT INTO public.conversations (type, project_id, sub_company_id, title, created_by)
          VALUES ('project', c.project_id, v_counter,
                  COALESCE((SELECT name FROM public.projects WHERE id = c.project_id), 'Project')
                    || ' — ' || COALESCE((SELECT name FROM public.companies WHERE id = v_counter), 'Company'),
                  c.created_by)
          RETURNING id INTO v_target;
        END IF;
        UPDATE public.messages SET conversation_id = v_target WHERE id = m.id;
      END IF;
    END LOOP;

    -- Legacy conversation keeps only owner-company participants
    DELETE FROM public.conversation_participants cp
    USING public.profiles p
    WHERE cp.conversation_id = c.id
      AND p.user_id = cp.user_id
      AND (p.company_id IS NULL OR p.company_id IS DISTINCT FROM v_owner);

    -- Drop legacy conversation entirely when nothing is left in it
    DELETE FROM public.conversations
     WHERE id = c.id
       AND NOT EXISTS (SELECT 1 FROM public.messages WHERE conversation_id = c.id);
  END LOOP;

  -- Sync participants on all per-sub conversations
  FOR c IN SELECT id FROM public.conversations WHERE type = 'project' AND sub_company_id IS NOT NULL LOOP
    PERFORM public.sync_project_sub_conversation_participants(c.id);
  END LOOP;
END $$;

-- 8. Refresh last_message_at
UPDATE public.conversations c
SET last_message_at = COALESCE((SELECT max(created_at) FROM public.messages m WHERE m.conversation_id = c.id), c.created_at)
WHERE c.type = 'project';