
-- 1) Allow projects.company_id to be NULL so a guest account can be deleted while
--    preserving its projects for connected subcontractors.
ALTER TABLE public.projects ALTER COLUMN company_id DROP NOT NULL;

-- 2) Replace CASCADE delete with SET NULL so a future company hard-delete
--    doesn't wipe preserved projects.
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_company_id_fkey;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;

-- 3) Snapshot owner display name so the Sub UI can still render an owner
--    label after the original company row is gone.
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS owner_display_name text;

-- Backfill snapshot from current owner names (idempotent).
UPDATE public.projects p
SET owner_display_name = c.name
FROM public.companies c
WHERE p.company_id = c.id
  AND p.owner_display_name IS NULL;
