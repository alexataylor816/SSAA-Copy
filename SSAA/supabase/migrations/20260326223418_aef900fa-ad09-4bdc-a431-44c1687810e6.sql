
-- Company deletion requests table
CREATE TABLE public.company_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  confirmed_by uuid
);

ALTER TABLE public.company_deletion_requests ENABLE ROW LEVEL SECURITY;

-- MOA can do everything
CREATE POLICY "MOA can manage deletion requests"
  ON public.company_deletion_requests
  FOR ALL
  TO authenticated
  USING (is_moa())
  WITH CHECK (is_moa());

-- Account holders can insert for own company
CREATE POLICY "Account holders can request deletion"
  ON public.company_deletion_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id = get_user_company_id()
    AND is_account_holder(company_id)
  );

-- Account holders can read own company requests
CREATE POLICY "Account holders can view own requests"
  ON public.company_deletion_requests
  FOR SELECT
  TO authenticated
  USING (
    company_id = get_user_company_id()
    AND is_account_holder(company_id)
  );

-- Allow MOA to delete companies
CREATE POLICY "MOA can delete companies"
  ON public.companies
  FOR DELETE
  TO authenticated
  USING (is_moa());
