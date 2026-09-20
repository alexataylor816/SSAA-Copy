DROP POLICY IF EXISTS "View tasks for accessible projects" ON public.tasks;

CREATE POLICY "View tasks for accessible projects" ON public.tasks
FOR SELECT USING (
  is_moa()
  OR EXISTS (
    SELECT 1 FROM public.projects
    WHERE projects.id = tasks.project_id
      AND projects.company_id = get_user_company_id()
  )
  OR EXISTS (
    SELECT 1 FROM public.project_connections pc
    WHERE pc.project_id = tasks.project_id
      AND pc.sub_company_id = get_user_company_id()
      AND (
        pc.share_schedule = true
        OR (pc.schedule_shared_until IS NOT NULL AND tasks.created_at <= pc.schedule_shared_until)
      )
  )
);

UPDATE public.tasks SET shared_with_subs = true WHERE shared_with_subs IS DISTINCT FROM true;