
CREATE TABLE public.operators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  operator_level text NOT NULL CHECK (operator_level IN ('main_operator', 'operator')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.operators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "MOA can select operators"
ON public.operators FOR SELECT
TO authenticated
USING (is_moa());

CREATE POLICY "MOA can insert operators"
ON public.operators FOR INSERT
TO authenticated
WITH CHECK (is_moa());

CREATE POLICY "MOA can update operators"
ON public.operators FOR UPDATE
TO authenticated
USING (is_moa());

CREATE POLICY "MOA can delete operators"
ON public.operators FOR DELETE
TO authenticated
USING (is_moa());

CREATE TRIGGER update_operators_updated_at
BEFORE UPDATE ON public.operators
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
