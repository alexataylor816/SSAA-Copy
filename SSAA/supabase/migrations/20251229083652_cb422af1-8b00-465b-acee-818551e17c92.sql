-- Update handle_new_user trigger to set company_id from metadata when provided
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER 
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, full_name, role, company_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email),
    'admin'::public.user_role,
    CASE 
      WHEN NEW.raw_user_meta_data ->> 'company_id' IS NOT NULL 
      THEN (NEW.raw_user_meta_data ->> 'company_id')::uuid 
      ELSE NULL 
    END
  );
  RETURN NEW;
END;
$$;