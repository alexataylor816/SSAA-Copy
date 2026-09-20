-- Add edited column to track when subcontractors modify confirmed requests
ALTER TABLE public.schedule_requests ADD COLUMN IF NOT EXISTS edited boolean DEFAULT false;