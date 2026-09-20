
CREATE TABLE public.company_join_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  company_id UUID NOT NULL REFERENCES public.companies(id),
  user_email TEXT NOT NULL,
  user_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.company_join_requests ENABLE ROW LEVEL SECURITY;

-- Users can insert their own requests
CREATE POLICY "Users can create join requests"
ON public.company_join_requests FOR INSERT
TO authenticated WITH CHECK (user_id = auth.uid());

-- Users can read their own requests
CREATE POLICY "Users can view own requests"
ON public.company_join_requests FOR SELECT
TO authenticated USING (user_id = auth.uid());

-- Admins can read company requests
CREATE POLICY "Admins can view company requests"
ON public.company_join_requests FOR SELECT
TO authenticated USING (
  is_moa() OR (
    company_id = get_user_company_id() AND
    get_user_permission_level() IN ('account_holder', 'full')
  )
);

-- Admins can update (approve/deny)
CREATE POLICY "Admins can update requests"
ON public.company_join_requests FOR UPDATE
TO authenticated USING (
  is_moa() OR (
    company_id = get_user_company_id() AND
    get_user_permission_level() IN ('account_holder', 'full')
  )
);

-- Trigger for updated_at
CREATE TRIGGER update_company_join_requests_updated_at
BEFORE UPDATE ON public.company_join_requests
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
