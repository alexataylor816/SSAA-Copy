CREATE OR REPLACE FUNCTION public.get_project_notification_user_ids(p_project_id uuid, p_company_id uuid)
RETURNS TABLE(user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT DISTINCT upa.user_id
  FROM public.user_project_assignments upa
  JOIN public.user_roles ur
    ON ur.user_id = upa.user_id
   AND ur.company_id = upa.company_id
  WHERE upa.project_id = p_project_id
    AND upa.company_id = p_company_id
    AND upa.receive_notifications = true
    AND ur.permission_level IN ('partial','full','account_holder')
$$;

CREATE OR REPLACE FUNCTION public.get_scheduled_personnel_user_ids(p_employee_ids uuid[])
RETURNS TABLE(user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT DISTINCT e.linked_user_id
  FROM public.employees e
  WHERE e.id = ANY(p_employee_ids)
    AND e.linked_user_id IS NOT NULL
$$;

REVOKE ALL ON FUNCTION public.get_project_notification_user_ids(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_scheduled_personnel_user_ids(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_project_notification_user_ids(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_scheduled_personnel_user_ids(uuid[]) TO authenticated, service_role;