
-- Chunk 3: Allow Main Contractors to read shared sub-of-sub personnel and their availability
-- for projects where sharing is enabled via contractor_connection_project_assignments.

DROP POLICY IF EXISTS "View employees for own company or MOA" ON public.employees;
CREATE POLICY "View employees for own company or MOA"
ON public.employees
FOR SELECT
USING (
  is_moa()
  OR company_id = get_user_company_id()
  OR EXISTS (
    SELECT 1 FROM public.project_connections pc
    JOIN public.projects p ON p.id = pc.project_id
    WHERE pc.sub_company_id = employees.company_id
      AND p.company_id = get_user_company_id()
  )
  OR EXISTS (
    SELECT 1 FROM public.guest_project_connections gpc
    WHERE gpc.guest_company_id = get_user_company_id()
      AND gpc.sub_company_id = employees.company_id
  )
  OR EXISTS (
    SELECT 1 FROM public.contractor_connection_project_assignments cpa
    WHERE cpa.shared = true
      AND cpa.main_company_id = get_user_company_id()
      AND cpa.sub_company_id = employees.company_id
  )
);

DROP POLICY IF EXISTS "View availability" ON public.availability;
CREATE POLICY "View availability"
ON public.availability
FOR SELECT
USING (
  is_moa()
  OR EXISTS (
    SELECT 1 FROM public.employees
    WHERE employees.id = availability.employee_id
      AND employees.company_id = get_user_company_id()
  )
  OR EXISTS (
    SELECT 1 FROM public.employees e
    JOIN public.project_connections pc ON pc.sub_company_id = e.company_id
    JOIN public.projects p ON p.id = pc.project_id
    WHERE e.id = availability.employee_id
      AND p.company_id = get_user_company_id()
  )
  OR EXISTS (
    SELECT 1 FROM public.employees e
    JOIN public.guest_project_connections gpc ON gpc.sub_company_id = e.company_id
    WHERE e.id = availability.employee_id
      AND gpc.guest_company_id = get_user_company_id()
  )
  OR EXISTS (
    SELECT 1 FROM public.employees e
    JOIN public.contractor_connection_project_assignments cpa ON cpa.sub_company_id = e.company_id
    WHERE e.id = availability.employee_id
      AND cpa.shared = true
      AND cpa.main_company_id = get_user_company_id()
  )
);
