DO $$
DECLARE
  v_partial_ids uuid[];
BEGIN
  -- 1. Identify availability rows with all_projects=true where the employee
  --    is NOT assigned to every project in their company.
  SELECT array_agg(a.id) INTO v_partial_ids
  FROM public.availability a
  JOIN public.employees e ON e.id = a.employee_id
  WHERE a.all_projects = true
    AND a.project_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.company_id = e.company_id
        AND NOT EXISTS (
          SELECT 1 FROM public.employee_project_assignments epa
          WHERE epa.employee_id = a.employee_id
            AND epa.project_id = p.id
        )
    );

  IF v_partial_ids IS NULL OR array_length(v_partial_ids, 1) IS NULL THEN
    RAISE NOTICE 'No partial all_projects rows to expand';
    RETURN;
  END IF;

  -- 2. Insert per-project rows for each project the employee IS assigned to.
  INSERT INTO public.availability (
    employee_id, project_id, start_time, end_time,
    all_projects, stop_number, stop_label, created_at
  )
  SELECT a.employee_id, epa.project_id, a.start_time, a.end_time,
         false, a.stop_number, a.stop_label, a.created_at
  FROM public.availability a
  JOIN public.employee_project_assignments epa ON epa.employee_id = a.employee_id
  WHERE a.id = ANY(v_partial_ids);

  -- 3. Delete the original all_projects rows that were expanded.
  DELETE FROM public.availability WHERE id = ANY(v_partial_ids);

  RAISE NOTICE 'Expanded % availability rows', array_length(v_partial_ids, 1);
END $$;