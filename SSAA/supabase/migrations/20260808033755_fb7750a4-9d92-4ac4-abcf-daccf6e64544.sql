CREATE OR REPLACE FUNCTION public.guard_schedule_request_confirmation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'confirmed' AND COALESCE(OLD.status, '') <> 'confirmed' THEN
    IF NEW.intermediary_company_id IS NOT NULL
       AND NOT public.is_moa()
       AND public.get_user_company_id() = NEW.intermediary_company_id
       AND NEW.sub_company_id IS DISTINCT FROM public.get_user_company_id() THEN
      RAISE EXCEPTION 'Only the subcontractor whose personnel are scheduled can approve this request';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;