CREATE OR REPLACE FUNCTION public.get_employee_cross_gc_bookings(p_company_id uuid, p_dates date[])
RETURNS TABLE(employee_id uuid, booking_date date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT unnest(sr.employee_ids) AS employee_id, sr.scheduled_date AS booking_date
  FROM public.schedule_requests sr
  WHERE sr.scheduled_date = ANY(p_dates)
    AND sr.status = 'confirmed'
    AND sr.requesting_company_id <> p_company_id
    AND EXISTS (
      SELECT 1 FROM public.project_connections pc
      JOIN public.projects p ON p.id = pc.project_id
      WHERE pc.sub_company_id = sr.sub_company_id
        AND p.company_id = p_company_id
    );
$$;