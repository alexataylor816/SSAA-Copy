ALTER TABLE public.schedule_requests
  ADD COLUMN IF NOT EXISTS intermediary_company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_schedule_requests_intermediary
  ON public.schedule_requests (intermediary_company_id);

DROP POLICY IF EXISTS "View schedule requests" ON public.schedule_requests;
CREATE POLICY "View schedule requests" ON public.schedule_requests
FOR SELECT USING (
  is_moa()
  OR requesting_company_id = get_user_company_id()
  OR sub_company_id = get_user_company_id()
  OR intermediary_company_id = get_user_company_id()
  OR owns_project(project_id)
);

DROP POLICY IF EXISTS "Update schedule requests" ON public.schedule_requests;
CREATE POLICY "Update schedule requests" ON public.schedule_requests
FOR UPDATE USING (
  is_moa()
  OR requesting_company_id = get_user_company_id()
  OR sub_company_id = get_user_company_id()
  OR intermediary_company_id = get_user_company_id()
  OR owns_project(project_id)
);

DROP POLICY IF EXISTS "Delete schedule requests" ON public.schedule_requests;
CREATE POLICY "Delete schedule requests" ON public.schedule_requests
FOR DELETE USING (
  is_moa()
  OR requesting_company_id = get_user_company_id()
  OR sub_company_id = get_user_company_id()
  OR intermediary_company_id = get_user_company_id()
  OR owns_project(project_id)
);

CREATE OR REPLACE FUNCTION public.guard_schedule_request_confirmation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'confirmed' AND COALESCE(OLD.status, '') <> 'confirmed' THEN
    IF NOT (
      public.is_moa()
      OR NEW.sub_company_id = public.get_user_company_id()
      OR NEW.sub_assigned = true
    ) THEN
      RAISE EXCEPTION 'Only the subcontractor whose personnel are scheduled can approve this request';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_schedule_request_confirmation ON public.schedule_requests;
CREATE TRIGGER trg_guard_schedule_request_confirmation
BEFORE UPDATE ON public.schedule_requests
FOR EACH ROW EXECUTE FUNCTION public.guard_schedule_request_confirmation();