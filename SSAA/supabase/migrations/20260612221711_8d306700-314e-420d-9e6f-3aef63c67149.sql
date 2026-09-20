-- ============================================================================
-- Schedule request grouping + guest-only project auto-assignment
-- ============================================================================

-- 0. Patch pre-existing sync_contacts_for_project — partial unique index needs
--    matching predicate in ON CONFLICT. Without it, every INSERT into
--    user_project_assignments errors out via the chat-sync chain.
CREATE OR REPLACE FUNCTION public.sync_contacts_for_project(p_project_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  WHERE b.user_id IS NOT NULL
  ON CONFLICT (owner_user_id, contact_user_id) WHERE contact_user_id IS NOT NULL DO NOTHING;
END;
$function$;

-- 1. SCHEMA: grouping columns on schedule_requests
ALTER TABLE public.schedule_requests
  ADD COLUMN IF NOT EXISTS request_group_id uuid,
  ADD COLUMN IF NOT EXISTS scheduled_dates date[];

CREATE INDEX IF NOT EXISTS idx_schedule_requests_group_id
  ON public.schedule_requests(request_group_id)
  WHERE request_group_id IS NOT NULL;

-- 2. Replace emit_schedule_request_system_message to collapse multi-day groups
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
    IF v_target.request_group_id IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.messages m
        WHERE m.kind = v_kind
          AND (m.metadata->>'request_group_id')::uuid = v_target.request_group_id
          AND m.created_at > now() - interval '1 minute'
      ) THEN
        RETURN NEW;
      END IF;
    END IF;
  ELSE
    RETURN OLD;
  END IF;

  v_conv_id := get_or_create_project_conversation(v_target.project_id);

  IF v_target.scheduled_dates IS NOT NULL AND array_length(v_target.scheduled_dates, 1) > 0 THEN
    v_dates := v_target.scheduled_dates;
  ELSIF v_target.request_group_id IS NOT NULL THEN
    SELECT array_agg(DISTINCT scheduled_date ORDER BY scheduled_date)
      INTO v_dates
      FROM public.schedule_requests
      WHERE request_group_id = v_target.request_group_id;
  ELSE
    v_dates := ARRAY[v_target.scheduled_date];
  END IF;

  v_emp_ids := v_target.employee_ids;

  IF v_emp_ids IS NOT NULL AND array_length(v_emp_ids, 1) > 0 THEN
    SELECT jsonb_agg(jsonb_build_object(
      'name', e.name,
      'job_title', e.job_title,
      'times', to_char(v_target.start_time, 'FMHH12:MI AM') || ' - ' || to_char(v_target.end_time, 'FMHH12:MI AM')
    ))
    INTO v_personnel
    FROM public.employees e
    WHERE e.id = ANY(v_emp_ids);
  END IF;

  v_meta := jsonb_build_object(
    'schedule_request_id', v_target.id,
    'request_group_id', v_target.request_group_id,
    'scheduled_date', v_target.scheduled_date,
    'scheduled_dates', to_jsonb(v_dates),
    'start_time', to_char(v_target.start_time, 'FMHH12:MI AM'),
    'end_time', to_char(v_target.end_time, 'FMHH12:MI AM'),
    'employee_ids', v_emp_ids,
    'personnel', COALESCE(v_personnel, '[]'::jsonb),
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
$function$;

-- 3. GUEST-ONLY auto-assignment helpers + triggers (insert-only, never delete)
CREATE OR REPLACE FUNCTION public.assign_guest_company_users_to_project(
  p_guest_company_id uuid,
  p_project_id uuid
) RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_guest_company_id AND is_guest = true) THEN
    RETURN;
  END IF;
  INSERT INTO public.user_project_assignments (user_id, project_id, company_id, receive_notifications)
  SELECT p.user_id, p_project_id, p_guest_company_id, true
  FROM public.profiles p
  WHERE p.company_id = p_guest_company_id
  ON CONFLICT (user_id, project_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_guest_conn_assign_users()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_project_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = NEW.guest_company_id AND is_guest = true) THEN
    RETURN NEW;
  END IF;
  FOR v_project_id IN
    SELECT pa.project_id
    FROM public.project_aliases pa
    JOIN public.projects p ON p.id = pa.project_id
    WHERE pa.company_id = NEW.guest_company_id
      AND p.company_id = NEW.sub_company_id
  LOOP
    PERFORM assign_guest_company_users_to_project(NEW.guest_company_id, v_project_id);
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guest_conn_assign_users ON public.guest_project_connections;
CREATE TRIGGER trg_guest_conn_assign_users
  AFTER INSERT ON public.guest_project_connections
  FOR EACH ROW EXECUTE FUNCTION public.tg_guest_conn_assign_users();

CREATE OR REPLACE FUNCTION public.tg_project_alias_assign_guest_users()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  PERFORM assign_guest_company_users_to_project(NEW.company_id, NEW.project_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_project_alias_assign_guest_users ON public.project_aliases;
CREATE TRIGGER trg_project_alias_assign_guest_users
  AFTER INSERT ON public.project_aliases
  FOR EACH ROW EXECUTE FUNCTION public.tg_project_alias_assign_guest_users();

CREATE OR REPLACE FUNCTION public.tg_project_assign_guest_owner_users()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  PERFORM assign_guest_company_users_to_project(NEW.company_id, NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_project_assign_guest_owner_users ON public.projects;
CREATE TRIGGER trg_project_assign_guest_owner_users
  AFTER INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.tg_project_assign_guest_owner_users();

CREATE OR REPLACE FUNCTION public.tg_profile_assign_guest_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_project_id uuid;
BEGIN
  IF NEW.company_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = NEW.company_id AND is_guest = true) THEN
    RETURN NEW;
  END IF;
  FOR v_project_id IN SELECT id FROM public.projects WHERE company_id = NEW.company_id LOOP
    INSERT INTO public.user_project_assignments (user_id, project_id, company_id, receive_notifications)
    VALUES (NEW.user_id, v_project_id, NEW.company_id, true)
    ON CONFLICT (user_id, project_id) DO NOTHING;
  END LOOP;
  FOR v_project_id IN SELECT project_id FROM public.project_aliases WHERE company_id = NEW.company_id LOOP
    INSERT INTO public.user_project_assignments (user_id, project_id, company_id, receive_notifications)
    VALUES (NEW.user_id, v_project_id, NEW.company_id, true)
    ON CONFLICT (user_id, project_id) DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_assign_guest_user ON public.profiles;
CREATE TRIGGER trg_profile_assign_guest_user
  AFTER INSERT OR UPDATE OF company_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_profile_assign_guest_user();

-- 4. ONE-TIME BACKFILL
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT p.id AS project_id, p.company_id AS guest_company_id
    FROM public.projects p
    JOIN public.companies c ON c.id = p.company_id
    WHERE c.is_guest = true
  LOOP
    PERFORM assign_guest_company_users_to_project(rec.guest_company_id, rec.project_id);
  END LOOP;

  FOR rec IN
    SELECT pa.project_id, pa.company_id AS guest_company_id
    FROM public.project_aliases pa
    JOIN public.companies c ON c.id = pa.company_id
    WHERE c.is_guest = true
  LOOP
    PERFORM assign_guest_company_users_to_project(rec.guest_company_id, rec.project_id);
  END LOOP;
END $$;

-- 4b. Targeted one-shot backfill: Circuit Electric users on consolidated project
INSERT INTO public.user_project_assignments (user_id, project_id, company_id, receive_notifications)
SELECT ur.user_id,
       'f0ceb27a-e6de-47c2-80f9-281fc3308d96'::uuid,
       '8273defe-0a73-4e01-872e-fe0f68aa4e05'::uuid,
       true
FROM public.user_roles ur
WHERE ur.company_id = '8273defe-0a73-4e01-872e-fe0f68aa4e05'::uuid
ON CONFLICT (user_id, project_id) DO NOTHING;

-- 5. Group existing duplicate schedule_requests
WITH grouped AS (
  SELECT id,
         FIRST_VALUE(id) OVER (
           PARTITION BY requesting_company_id, sub_company_id, project_id,
                        start_time, end_time, COALESCE(description, ''),
                        date_trunc('minute', created_at)
           ORDER BY created_at
         ) AS leader_id
  FROM public.schedule_requests
  WHERE request_group_id IS NULL
)
UPDATE public.schedule_requests sr
SET request_group_id = grouped.leader_id
FROM grouped
WHERE sr.id = grouped.id
  AND EXISTS (
    SELECT 1 FROM public.schedule_requests sr2
    WHERE sr2.requesting_company_id = sr.requesting_company_id
      AND sr2.sub_company_id = sr.sub_company_id
      AND sr2.project_id = sr.project_id
      AND COALESCE(sr2.start_time, '00:00'::time) = COALESCE(sr.start_time, '00:00'::time)
      AND COALESCE(sr2.end_time, '00:00'::time) = COALESCE(sr.end_time, '00:00'::time)
      AND COALESCE(sr2.description, '') = COALESCE(sr.description, '')
      AND sr2.id <> sr.id
      AND abs(extract(epoch FROM (sr2.created_at - sr.created_at))) < 60
  );

-- Populate scheduled_dates for backfilled groups
UPDATE public.schedule_requests sr
SET scheduled_dates = sub.dates
FROM (
  SELECT request_group_id, array_agg(DISTINCT scheduled_date ORDER BY scheduled_date) AS dates
  FROM public.schedule_requests
  WHERE request_group_id IS NOT NULL
  GROUP BY request_group_id
) sub
WHERE sr.request_group_id = sub.request_group_id
  AND (sr.scheduled_dates IS NULL OR sr.scheduled_dates = '{}');

-- Delete duplicate system messages, keeping the earliest per (kind, group)
WITH msg_groups AS (
  SELECT m.id, m.kind, m.created_at, sr.request_group_id
  FROM public.messages m
  JOIN public.schedule_requests sr ON sr.id = (m.metadata->>'schedule_request_id')::uuid
  WHERE m.kind IN ('system_schedule_request','system_schedule_confirm','system_schedule_reject','system_schedule_cancel','system_schedule_edit')
    AND sr.request_group_id IS NOT NULL
),
ranked AS (
  SELECT id, kind, request_group_id, created_at,
         row_number() OVER (PARTITION BY kind, request_group_id ORDER BY created_at) AS rn
  FROM msg_groups
)
DELETE FROM public.messages
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);