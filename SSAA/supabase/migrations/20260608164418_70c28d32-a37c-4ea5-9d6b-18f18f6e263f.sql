DROP POLICY IF EXISTS "View schedule requests" ON public.schedule_requests;
DROP POLICY IF EXISTS "Update schedule requests" ON public.schedule_requests;
DROP POLICY IF EXISTS "Delete schedule requests" ON public.schedule_requests;

CREATE POLICY "View schedule requests" ON public.schedule_requests
FOR SELECT TO authenticated
USING (
  is_moa()
  OR requesting_company_id = get_user_company_id()
  OR sub_company_id = get_user_company_id()
  OR owns_project(project_id)
);

CREATE POLICY "Update schedule requests" ON public.schedule_requests
FOR UPDATE TO authenticated
USING (
  is_moa()
  OR requesting_company_id = get_user_company_id()
  OR sub_company_id = get_user_company_id()
  OR owns_project(project_id)
);

CREATE POLICY "Delete schedule requests" ON public.schedule_requests
FOR DELETE TO authenticated
USING (
  is_moa()
  OR requesting_company_id = get_user_company_id()
  OR sub_company_id = get_user_company_id()
  OR owns_project(project_id)
);