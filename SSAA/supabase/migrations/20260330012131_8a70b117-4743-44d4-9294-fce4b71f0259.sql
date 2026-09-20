
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS shared_with_subs boolean DEFAULT false;

-- Update RLS: subs can only see shared tasks
DROP POLICY IF EXISTS "View tasks for accessible projects" ON public.tasks;
CREATE POLICY "View tasks for accessible projects" ON public.tasks
FOR SELECT TO public
USING (
  is_moa()
  OR EXISTS (SELECT 1 FROM projects WHERE projects.id = tasks.project_id AND projects.company_id = get_user_company_id())
  OR (
    shared_with_subs = true
    AND EXISTS (SELECT 1 FROM project_connections WHERE project_connections.project_id = tasks.project_id AND project_connections.sub_company_id = get_user_company_id())
  )
);
