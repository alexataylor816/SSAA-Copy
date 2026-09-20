DROP POLICY IF EXISTS "View employee project assignments" ON public.employee_project_assignments;

CREATE POLICY "View employee project assignments"
ON public.employee_project_assignments
FOR SELECT
USING (
  is_moa()
  OR company_id = get_user_company_id()
  OR can_view_project(project_id)
);