-- Add columns to track change history for schedule requests
ALTER TABLE public.schedule_requests
ADD COLUMN original_employee_ids uuid[] DEFAULT '{}',
ADD COLUMN original_start_time time without time zone,
ADD COLUMN original_end_time time without time zone,
ADD COLUMN last_edited_by_company_id uuid REFERENCES public.companies(id);