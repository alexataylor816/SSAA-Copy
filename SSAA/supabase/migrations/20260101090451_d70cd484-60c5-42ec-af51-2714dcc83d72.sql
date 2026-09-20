-- Create a function to look up projects by connection code (bypasses RLS)
CREATE OR REPLACE FUNCTION public.get_project_by_connection_code(p_code text)
RETURNS TABLE(id uuid, name text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, name FROM projects
  WHERE connection_code = p_code
  LIMIT 1
$$;