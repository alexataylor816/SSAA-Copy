CREATE OR REPLACE FUNCTION public.get_project_notification_recipients(p_project_id uuid, p_company_id uuid)
 RETURNS TABLE(email text, phone text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT DISTINCT pr.email, pr.phone
  FROM public.user_project_assignments upa
  JOIN public.profiles pr ON pr.user_id = upa.user_id
  JOIN public.user_roles ur
    ON ur.user_id = upa.user_id
   AND ur.company_id = upa.company_id
  WHERE upa.project_id = p_project_id
    AND upa.company_id = p_company_id
    AND upa.receive_notifications = true
    AND ur.permission_level IN ('partial','full','account_holder')
$function$;
REVOKE EXECUTE ON FUNCTION public.get_project_notification_recipients(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_project_notification_recipients(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_scheduled_personnel_recipients(p_employee_ids uuid[])
 RETURNS TABLE(email text, phone text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT DISTINCT email, phone FROM (
    SELECT NULLIF(trim(e.email), '') AS email, NULLIF(trim(e.phone), '') AS phone
    FROM public.employees e WHERE e.id = ANY(p_employee_ids)
    UNION ALL
    SELECT NULLIF(trim(pr.email), ''), NULLIF(trim(pr.phone), '')
    FROM public.employees e
    JOIN public.profiles pr ON pr.user_id = e.linked_user_id
    WHERE e.id = ANY(p_employee_ids) AND e.linked_user_id IS NOT NULL
  ) x
  WHERE email IS NOT NULL OR phone IS NOT NULL
$function$;
REVOKE EXECUTE ON FUNCTION public.get_scheduled_personnel_recipients(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_scheduled_personnel_recipients(uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_schedulable_employee_ids(p_company_id uuid)
 RETURNS TABLE(employee_id uuid)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT e.id FROM public.employees e
  WHERE e.company_id = p_company_id
    AND (
      e.linked_user_id IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = e.linked_user_id
          AND ur.company_id = e.company_id
          AND ur.permission_level IN ('partial','full','account_holder')
      )
    )
$function$;
REVOKE EXECUTE ON FUNCTION public.get_schedulable_employee_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_schedulable_employee_ids(uuid) TO authenticated, service_role;

INSERT INTO public.notification_templates (event_type, channel, subject, body_html, is_active, placeholder_variables)
VALUES
  ('schedule_confirmed_personnel', 'email',
   'You have been scheduled for {project_name}',
   '<p>Hi {recipient_name},</p><p>You have been scheduled to work on <strong>{project_name}</strong> ({project_address}) on <strong>{scheduled_date}</strong> from <strong>{start_time}</strong> to <strong>{end_time}</strong>.</p><p>Please contact your supervisor with any questions.</p><p>Thank you,<br/>SSAA</p>',
   true,
   ARRAY['recipient_name','project_name','project_address','scheduled_date','start_time','end_time']),
  ('schedule_confirmed_personnel', 'sms',
   '',
   'SSAA: You are scheduled on {project_name} {scheduled_date} {start_time}-{end_time}.',
   true,
   ARRAY['project_name','scheduled_date','start_time','end_time'])
ON CONFLICT (event_type, channel) DO NOTHING;