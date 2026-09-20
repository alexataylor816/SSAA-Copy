-- Update availability RLS policy to allow GCs to see connected sub's employees availability
DROP POLICY IF EXISTS "View availability" ON public.availability;

CREATE POLICY "View availability" ON public.availability
FOR SELECT USING (
  is_moa() 
  OR (
    -- Own company's employees
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = availability.employee_id 
      AND employees.company_id = get_user_company_id()
    )
  )
  OR (
    -- GC viewing connected sub's employees availability
    EXISTS (
      SELECT 1 FROM employees e
      JOIN project_connections pc ON pc.sub_company_id = e.company_id
      JOIN projects p ON p.id = pc.project_id
      WHERE e.id = availability.employee_id
      AND p.company_id = get_user_company_id()
    )
  )
);

-- Update employees RLS policy to allow GCs to see connected sub's employees
DROP POLICY IF EXISTS "View employees for own company or MOA" ON public.employees;

CREATE POLICY "View employees for own company or MOA" ON public.employees
FOR SELECT USING (
  is_moa() 
  OR company_id = get_user_company_id()
  OR (
    -- GC viewing connected sub's employees
    EXISTS (
      SELECT 1 FROM project_connections pc
      JOIN projects p ON p.id = pc.project_id
      WHERE pc.sub_company_id = employees.company_id
      AND p.company_id = get_user_company_id()
    )
  )
);