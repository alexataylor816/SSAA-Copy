CREATE OR REPLACE FUNCTION public.guard_profile_sensitive_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Allow service_role to bypass all checks (used by operator management RPC)
  IF current_setting('role') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF is_moa() THEN
    RETURN NEW;
  END IF;

  IF OLD.role IS DISTINCT FROM NEW.role THEN
    RAISE EXCEPTION 'Only MOA can change profile role';
  END IF;
  
  IF OLD.user_id IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'Cannot change profile user_id';
  END IF;
  
  IF OLD.company_id IS DISTINCT FROM NEW.company_id THEN
    IF OLD.user_id != auth.uid() THEN
      RAISE EXCEPTION 'Only MOA can change profile company_id';
    END IF;
  END IF;
  
  IF OLD.force_password_change IS DISTINCT FROM NEW.force_password_change THEN
    RAISE EXCEPTION 'Only MOA can change force_password_change';
  END IF;

  RETURN NEW;
END;
$function$;