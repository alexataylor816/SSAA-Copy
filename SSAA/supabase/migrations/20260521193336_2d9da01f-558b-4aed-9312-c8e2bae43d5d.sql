DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.projects;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

ALTER TABLE public.projects REPLICA IDENTITY FULL;