
-- Add columns to project_connections
ALTER TABLE public.project_connections
  ADD COLUMN share_schedule boolean NOT NULL DEFAULT true,
  ADD COLUMN schedule_shared_until timestamp with time zone DEFAULT NULL;

-- Allow project owners and MOA to update project_connections
CREATE POLICY "Update connections"
  ON public.project_connections
  FOR UPDATE
  USING (is_moa() OR owns_project(project_id))
  WITH CHECK (is_moa() OR owns_project(project_id));

-- Drop and recreate the tasks SELECT policy to incorporate share_schedule check
DROP POLICY IF EXISTS "View tasks for accessible projects" ON public.tasks;

CREATE POLICY "View tasks for accessible projects"
  ON public.tasks
  FOR SELECT
  USING (
    is_moa()
    OR (EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = tasks.project_id
        AND projects.company_id = get_user_company_id()
    ))
    OR (
      shared_with_subs = true
      AND EXISTS (
        SELECT 1 FROM project_connections pc
        WHERE pc.project_id = tasks.project_id
          AND pc.sub_company_id = get_user_company_id()
          AND (
            pc.share_schedule = true
            OR (pc.schedule_shared_until IS NOT NULL AND tasks.created_at <= pc.schedule_shared_until)
          )
      )
    )
  );
