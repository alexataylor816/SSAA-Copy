-- Add status column to tasks table
ALTER TABLE public.tasks 
ADD COLUMN status text DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed'));