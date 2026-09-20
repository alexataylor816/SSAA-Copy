-- Add state-restoration columns to operators
ALTER TABLE public.operators
ADD COLUMN previous_role text,
ADD COLUMN previous_company_id uuid,
ADD COLUMN is_new_user boolean NOT NULL DEFAULT true;

-- Create a SECURITY DEFINER function that bypasses the profile trigger
-- Only callable by service_role (edge functions)
CREATE OR REPLACE FUNCTION public.service_role_update_profile_for_operator(
  p_user_id uuid,
  p_role text,
  p_full_name text DEFAULT NULL,
  p_force_password_change boolean DEFAULT false,
  p_company_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only allow service_role to call this
  IF current_setting('role') != 'service_role' THEN
    RAISE EXCEPTION 'Only service role can call this function';
  END IF;

  UPDATE public.profiles
  SET 
    role = p_role::public.user_role,
    full_name = COALESCE(p_full_name, full_name),
    force_password_change = p_force_password_change,
    company_id = p_company_id
  WHERE user_id = p_user_id;
END;
$$;