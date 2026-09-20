
DROP TRIGGER IF EXISTS on_project_connection_created ON public.project_connections;

DELETE FROM public.employee_project_assignments epa
USING public.projects p, public.employees e
WHERE epa.project_id = p.id
  AND epa.employee_id = e.id
  AND p.company_id <> e.company_id
  AND NOT EXISTS (
    SELECT 1 FROM public.availability a
    WHERE a.employee_id = epa.employee_id AND a.project_id = epa.project_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.schedule_requests sr
    WHERE sr.project_id = epa.project_id
      AND epa.employee_id = ANY(sr.employee_ids)
  );
