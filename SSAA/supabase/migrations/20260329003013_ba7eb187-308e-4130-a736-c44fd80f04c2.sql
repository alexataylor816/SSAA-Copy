
-- 1. Update auto_create_guest_project to use 'Customers Calendar'
CREATE OR REPLACE FUNCTION public.auto_create_guest_project()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.company_type = 'sub' THEN
    INSERT INTO public.projects (company_id, name, address)
    VALUES (NEW.id, 'Customers Calendar', NEW.address);
  END IF;
  RETURN NEW;
END;
$function$;

-- 2. Rename existing projects
UPDATE public.projects SET name = 'Customers Calendar' WHERE name = 'For GC''s With No Company Account';

-- 3. Add metadata jsonb column to notification_templates
ALTER TABLE public.notification_templates ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
