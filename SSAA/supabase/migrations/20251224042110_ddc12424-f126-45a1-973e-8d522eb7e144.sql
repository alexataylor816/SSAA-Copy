-- Add linked_user_id column to employees table for tracking user-employee connections
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS linked_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_employees_linked_user_id ON public.employees(linked_user_id);