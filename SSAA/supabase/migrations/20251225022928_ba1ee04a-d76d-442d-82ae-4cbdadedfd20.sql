-- Add stop_number and stop_label columns to availability table for multiple stops
ALTER TABLE public.availability 
ADD COLUMN stop_number INTEGER DEFAULT NULL,
ADD COLUMN stop_label TEXT DEFAULT NULL;

-- Add index for efficient querying by stop
CREATE INDEX idx_availability_stop_number ON public.availability(employee_id, stop_number);