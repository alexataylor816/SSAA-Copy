ALTER TABLE public.schedule_requests ADD COLUMN sub_assigned boolean NOT NULL DEFAULT false;
ALTER TABLE public.schedule_requests ADD COLUMN silent_assignment boolean NOT NULL DEFAULT false;