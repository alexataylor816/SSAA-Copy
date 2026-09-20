
-- Create employee_project_assignments table
CREATE TABLE public.employee_project_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  receive_notifications boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_id, project_id)
);

ALTER TABLE public.employee_project_assignments ENABLE ROW LEVEL SECURITY;

-- RLS: same company + partial or higher, or MOA
CREATE POLICY "View employee project assignments"
  ON public.employee_project_assignments FOR SELECT
  USING (is_moa() OR (company_id = get_user_company_id() AND has_partial_or_higher()));

CREATE POLICY "Insert employee project assignments"
  ON public.employee_project_assignments FOR INSERT
  WITH CHECK (is_moa() OR (company_id = get_user_company_id() AND has_partial_or_higher()));

CREATE POLICY "Update employee project assignments"
  ON public.employee_project_assignments FOR UPDATE
  USING (is_moa() OR (company_id = get_user_company_id() AND has_partial_or_higher()));

CREATE POLICY "Delete employee project assignments"
  ON public.employee_project_assignments FOR DELETE
  USING (is_moa() OR (company_id = get_user_company_id() AND has_partial_or_higher()));

-- Trigger: auto-assign new employee to all company projects (owned + connected)
CREATE OR REPLACE FUNCTION public.auto_assign_employee_to_projects()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Owned projects
  INSERT INTO public.employee_project_assignments (employee_id, project_id, company_id)
  SELECT NEW.id, p.id, NEW.company_id
  FROM public.projects p
  WHERE p.company_id = NEW.company_id
  ON CONFLICT (employee_id, project_id) DO NOTHING;

  -- Connected projects (sub connected to GC projects)
  INSERT INTO public.employee_project_assignments (employee_id, project_id, company_id)
  SELECT NEW.id, pc.project_id, NEW.company_id
  FROM public.project_connections pc
  WHERE pc.sub_company_id = NEW.company_id
  ON CONFLICT (employee_id, project_id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_employee_created
  AFTER INSERT ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_assign_employee_to_projects();

-- Trigger: auto-assign all company employees when a new project is created
CREATE OR REPLACE FUNCTION public.auto_assign_employees_to_new_project()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.employee_project_assignments (employee_id, project_id, company_id)
  SELECT e.id, NEW.id, e.company_id
  FROM public.employees e
  WHERE e.company_id = NEW.company_id
  ON CONFLICT (employee_id, project_id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_project_created
  AFTER INSERT ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_assign_employees_to_new_project();

-- Trigger: auto-assign sub company employees when a new project_connection is created
CREATE OR REPLACE FUNCTION public.auto_assign_employees_on_project_connection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.employee_project_assignments (employee_id, project_id, company_id)
  SELECT e.id, NEW.project_id, e.company_id
  FROM public.employees e
  WHERE e.company_id = NEW.sub_company_id
  ON CONFLICT (employee_id, project_id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_project_connection_created
  AFTER INSERT ON public.project_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_assign_employees_on_project_connection();

-- Backfill: assign all existing employees to their company's owned projects
INSERT INTO public.employee_project_assignments (employee_id, project_id, company_id)
SELECT e.id, p.id, e.company_id
FROM public.employees e
JOIN public.projects p ON p.company_id = e.company_id
ON CONFLICT (employee_id, project_id) DO NOTHING;

-- Backfill: assign all existing employees to connected projects
INSERT INTO public.employee_project_assignments (employee_id, project_id, company_id)
SELECT e.id, pc.project_id, e.company_id
FROM public.employees e
JOIN public.project_connections pc ON pc.sub_company_id = e.company_id
ON CONFLICT (employee_id, project_id) DO NOTHING;
