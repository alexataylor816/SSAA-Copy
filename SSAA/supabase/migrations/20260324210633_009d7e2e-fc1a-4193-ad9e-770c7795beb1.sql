
-- Trigger function: sync profile email changes to employees and auth
CREATE OR REPLACE FUNCTION public.sync_profile_email_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public' AS $$
BEGIN
  IF OLD.email IS DISTINCT FROM NEW.email THEN
    -- Update linked employee email
    UPDATE public.employees 
    SET email = NEW.email 
    WHERE linked_user_id = OLD.user_id;
    
    -- Call edge function to update auth email via pg_net
    PERFORM net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/update-auth-user-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := jsonb_build_object('user_id', OLD.user_id::text, 'new_email', NEW.email)
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_email_on_profile_update
  AFTER UPDATE OF email ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_email_change();
