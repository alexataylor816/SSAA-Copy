-- Chunk 4: attribute Main-Contractor-on-behalf schedule messages with target sub company info
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

  v_conv_id := get_or_create_project_conversation(v_target.project_id);

  v_emp_ids := v_target.employee_ids;

  -- Determine sub-of-sub target company: prefer stored target_sub_company_id,
  -- otherwise infer from employees' owning company when it differs from the acting/requesting company.
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

  -- on_behalf_of on the message = the sub-of-sub whose personnel this is really for
  v_on_behalf := v_target_sub_company_id;

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