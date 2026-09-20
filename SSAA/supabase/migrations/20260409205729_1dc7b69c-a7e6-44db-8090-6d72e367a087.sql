
-- Helper function: is the current user the OMO?
CREATE OR REPLACE FUNCTION public.is_omo()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid()
      AND role = 'moa'
      AND lower(email) = 'lukepaaron@gmail.com'
  )
$$;

-- Drop existing mutation policies
DROP POLICY IF EXISTS "MOA can insert operators" ON public.operators;
DROP POLICY IF EXISTS "MOA can update operators" ON public.operators;
DROP POLICY IF EXISTS "MOA can delete operators" ON public.operators;

-- Recreate as OMO-only
CREATE POLICY "OMO can insert operators"
ON public.operators
FOR INSERT TO authenticated
WITH CHECK (is_omo());

CREATE POLICY "OMO can update operators"
ON public.operators
FOR UPDATE TO authenticated
USING (is_omo());

CREATE POLICY "OMO can delete operators"
ON public.operators
FOR DELETE TO authenticated
USING (is_omo());
