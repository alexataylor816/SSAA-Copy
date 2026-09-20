
-- Allow Guest GCs to see "For GC's With No Company Account" projects from their connected subs
DROP POLICY IF EXISTS "View projects for own company or connected or MOA" ON public.projects;
CREATE POLICY "View projects for own company or connected or MOA"
ON public.projects FOR SELECT
USING (
  is_moa()
  OR (company_id = get_user_company_id())
  OR is_connected_to_project(id)
  OR EXISTS (
    SELECT 1 FROM public.guest_project_connections gpc
    WHERE gpc.guest_company_id = get_user_company_id()
      AND gpc.sub_company_id = projects.company_id
  )
);

-- Allow Guest GCs to view employees of their connected subs
DROP POLICY IF EXISTS "View employees for own company or MOA" ON public.employees;
CREATE POLICY "View employees for own company or MOA"
ON public.employees FOR SELECT
USING (
  is_moa()
  OR (company_id = get_user_company_id())
  OR EXISTS (
    SELECT 1 FROM project_connections pc
    JOIN projects p ON p.id = pc.project_id
    WHERE pc.sub_company_id = employees.company_id
      AND p.company_id = get_user_company_id()
  )
  OR EXISTS (
    SELECT 1 FROM public.guest_project_connections gpc
    WHERE gpc.guest_company_id = get_user_company_id()
      AND gpc.sub_company_id = employees.company_id
  )
);

-- Allow Guest GCs to view availability of connected sub employees
DROP POLICY IF EXISTS "View availability" ON public.availability;
CREATE POLICY "View availability"
ON public.availability FOR SELECT
USING (
  is_moa()
  OR EXISTS (
    SELECT 1 FROM employees
    WHERE employees.id = availability.employee_id
      AND employees.company_id = get_user_company_id()
  )
  OR EXISTS (
    SELECT 1 FROM employees e
    JOIN project_connections pc ON pc.sub_company_id = e.company_id
    JOIN projects p ON p.id = pc.project_id
    WHERE e.id = availability.employee_id
      AND p.company_id = get_user_company_id()
  )
  OR EXISTS (
    SELECT 1 FROM employees e
    JOIN guest_project_connections gpc ON gpc.sub_company_id = e.company_id
    WHERE e.id = availability.employee_id
      AND gpc.guest_company_id = get_user_company_id()
  )
);
