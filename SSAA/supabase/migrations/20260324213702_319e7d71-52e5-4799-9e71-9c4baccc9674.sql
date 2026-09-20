
-- 1. Create profile_email_sync_queue table
CREATE TABLE public.profile_email_sync_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  new_email text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

ALTER TABLE public.profile_email_sync_queue ENABLE ROW LEVEL SECURITY;

-- Only service role / edge functions access this table
CREATE POLICY "No direct user access to sync queue"
ON public.profile_email_sync_queue FOR ALL
USING (false);

-- 2. Replace the broken trigger function with queue-based approach
CREATE OR REPLACE FUNCTION public.sync_profile_email_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public' AS $$
BEGIN
  IF OLD.email IS DISTINCT FROM NEW.email THEN
    -- Update linked employee email immediately
    UPDATE public.employees 
    SET email = NEW.email 
    WHERE linked_user_id = OLD.user_id;
    
    -- Queue auth email sync (processed by edge function)
    INSERT INTO public.profile_email_sync_queue (user_id, new_email)
    VALUES (OLD.user_id, NEW.email);
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Update profiles UPDATE RLS policy to allow same-company privileged editors
DROP POLICY IF EXISTS "Users can update own profile or MOA can update any" ON public.profiles;

CREATE POLICY "Users can update own profile or privileged can update company"
ON public.profiles FOR UPDATE
USING (
  user_id = auth.uid()
  OR is_moa()
  OR (company_id = get_user_company_id() AND has_partial_or_higher())
);

-- 4. Add immutable-field guard trigger (prevent non-MOA from changing sensitive fields)
CREATE OR REPLACE FUNCTION public.guard_profile_sensitive_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public' AS $$
BEGIN
  -- If caller is MOA, allow everything
  IF is_moa() THEN
    RETURN NEW;
  END IF;

  -- Block changes to sensitive fields for non-MOA
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    RAISE EXCEPTION 'Only MOA can change profile role';
  END IF;
  IF OLD.user_id IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'Cannot change profile user_id';
  END IF;
  IF OLD.company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'Only MOA can change profile company_id';
  END IF;
  IF OLD.force_password_change IS DISTINCT FROM NEW.force_password_change THEN
    RAISE EXCEPTION 'Only MOA can change force_password_change';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_profile_sensitive_fields_trigger
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_sensitive_fields();
