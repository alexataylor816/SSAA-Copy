-- Add DELETE policy for project_connections to allow GC users (project owners) to disconnect subs
CREATE POLICY "Project owners or MOA can delete connections"
ON public.project_connections
FOR DELETE
USING (
  is_moa() 
  OR owns_project(project_id) 
  OR sub_company_id = get_user_company_id()
);