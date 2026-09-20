-- First, drop the problematic policies on projects table
DROP POLICY IF EXISTS "View projects for own company or connected or MOA" ON public.projects;

-- Create a security definer function to check if user can view a project
CREATE OR REPLACE FUNCTION public.can_view_project(project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_id AND (
      p.company_id = get_user_company_id()
      OR is_moa()
      OR EXISTS (
        SELECT 1 FROM public.project_connections pc
        WHERE pc.project_id = p.id AND pc.sub_company_id = get_user_company_id()
      )
    )
  )
$$;

-- Create new policy without recursion
CREATE POLICY "View projects for own company or connected or MOA" 
ON public.projects 
FOR SELECT 
USING (
  is_moa() 
  OR company_id = get_user_company_id() 
  OR id IN (
    SELECT pc.project_id FROM public.project_connections pc 
    WHERE pc.sub_company_id = get_user_company_id()
  )
);

-- Also add job_title column to employees table
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS job_title text;