CREATE OR REPLACE FUNCTION public.get_project_notification_recipients(
  p_project_id uuid,
  p_company_id uuid
)
RETURNS TABLE(email text, phone text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pr.email, pr.phone
  FROM public.user_project_assignments upa
  JOIN public.profiles pr ON pr.user_id = upa.user_id
  WHERE upa.project_id = p_project_id
    AND upa.company_id = p_company_id
    AND upa.receive_notifications = true
$$;

GRANT EXECUTE ON FUNCTION public.get_project_notification_recipients(uuid, uuid)
  TO authenticated, anon, service_role;