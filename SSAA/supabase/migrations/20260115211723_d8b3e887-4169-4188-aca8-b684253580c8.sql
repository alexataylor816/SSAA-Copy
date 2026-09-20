-- Add column to track who initiated the cancellation/rejection
ALTER TABLE public.schedule_requests 
ADD COLUMN cancelled_by_company_id uuid REFERENCES public.companies(id);