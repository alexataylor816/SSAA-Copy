
-- Create user_project_assignments table
CREATE TABLE public.user_project_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  receive_notifications boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, project_id)
);

-- Enable RLS
ALTER TABLE public.user_project_assignments ENABLE ROW LEVEL SECURITY;

-- SELECT: company members with partial+ or MOA
CREATE POLICY "View project assignments"
  ON public.user_project_assignments
  FOR SELECT
  USING (is_moa() OR (company_id = get_user_company_id() AND has_partial_or_higher()));

-- INSERT: company members with partial+ or MOA
CREATE POLICY "Insert project assignments"
  ON public.user_project_assignments
  FOR INSERT
  WITH CHECK (is_moa() OR (company_id = get_user_company_id() AND has_partial_or_higher()));

-- UPDATE: company members with partial+ or MOA
CREATE POLICY "Update project assignments"
  ON public.user_project_assignments
  FOR UPDATE
  USING (is_moa() OR (company_id = get_user_company_id() AND has_partial_or_higher()));

-- DELETE: company members with partial+ or MOA
CREATE POLICY "Delete project assignments"
  ON public.user_project_assignments
  FOR DELETE
  USING (is_moa() OR (company_id = get_user_company_id() AND has_partial_or_higher()));
