
-- Drop the problematic project_connections SELECT policy that causes recursion
DROP POLICY IF EXISTS "View connections for own company or MOA" ON public.project_connections;

-- Create a security definer function to check if user owns the project (without querying projects with RLS)
CREATE OR REPLACE FUNCTION public.owns_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects
    WHERE id = p_project_id AND company_id = get_user_company_id()
  )
$$;

-- Create a security definer function to check if user is connected to project
CREATE OR REPLACE FUNCTION public.is_connected_to_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_connections
    WHERE project_id = p_project_id AND sub_company_id = get_user_company_id()
  )
$$;

-- Recreate project_connections SELECT policy using security definer function
CREATE POLICY "View connections for own company or MOA" ON public.project_connections
FOR SELECT USING (
  is_moa() 
  OR sub_company_id = get_user_company_id() 
  OR owns_project(project_id)
);

-- Drop and recreate projects SELECT policy to use security definer functions
DROP POLICY IF EXISTS "View projects for own company or connected or MOA" ON public.projects;

CREATE POLICY "View projects for own company or connected or MOA" ON public.projects
FOR SELECT USING (
  is_moa() 
  OR company_id = get_user_company_id() 
  OR is_connected_to_project(id)
);
