
-- Fix FK on company_join_requests.company_id: CASCADE
ALTER TABLE public.company_join_requests DROP CONSTRAINT IF EXISTS company_join_requests_company_id_fkey;
ALTER TABLE public.company_join_requests ADD CONSTRAINT company_join_requests_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

-- Fix FK on schedule_requests.cancelled_by_company_id: SET NULL
ALTER TABLE public.schedule_requests DROP CONSTRAINT IF EXISTS schedule_requests_cancelled_by_company_id_fkey;
ALTER TABLE public.schedule_requests ADD CONSTRAINT schedule_requests_cancelled_by_company_id_fkey FOREIGN KEY (cancelled_by_company_id) REFERENCES public.companies(id) ON DELETE SET NULL;

-- Fix FK on schedule_requests.last_edited_by_company_id: SET NULL
ALTER TABLE public.schedule_requests DROP CONSTRAINT IF EXISTS schedule_requests_last_edited_by_company_id_fkey;
ALTER TABLE public.schedule_requests ADD CONSTRAINT schedule_requests_last_edited_by_company_id_fkey FOREIGN KEY (last_edited_by_company_id) REFERENCES public.companies(id) ON DELETE SET NULL;

-- Fix FK on notification_log.recipient_company_id: SET NULL
ALTER TABLE public.notification_log DROP CONSTRAINT IF EXISTS notification_log_recipient_company_id_fkey;
ALTER TABLE public.notification_log ADD CONSTRAINT notification_log_recipient_company_id_fkey FOREIGN KEY (recipient_company_id) REFERENCES public.companies(id) ON DELETE SET NULL;
