
-- 1. Extend can_view_project to include guest GCs that have an alias for the project
CREATE OR REPLACE FUNCTION public.can_view_project(project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_id AND (
      p.company_id = get_user_company_id()
      OR is_moa()
      OR EXISTS (
        SELECT 1 FROM public.project_connections pc
        WHERE pc.project_id = p.id AND pc.sub_company_id = get_user_company_id()
      )
      OR EXISTS (
        SELECT 1 FROM public.guest_project_connections gpc
        WHERE gpc.guest_company_id = get_user_company_id()
          AND gpc.sub_company_id = p.company_id
          AND EXISTS (
            SELECT 1 FROM public.project_aliases pa
            WHERE pa.project_id = p.id
              AND pa.company_id = get_user_company_id()
          )
      )
    )
  )
$function$;

-- 2. Tighten projects SELECT policy: guest GCs only see projects they were explicitly invited to
DROP POLICY IF EXISTS "View projects for own company or connected or MOA" ON public.projects;
CREATE POLICY "View projects for own company or connected or MOA"
ON public.projects
FOR SELECT
USING (
  is_moa()
  OR (company_id = get_user_company_id())
  OR is_connected_to_project(id)
  OR EXISTS (
    SELECT 1 FROM public.project_aliases pa
    WHERE pa.project_id = projects.id
      AND pa.company_id = get_user_company_id()
  )
);

-- 3. Scope project chat participant sync so guest GCs are only added to projects
--    they were explicitly invited to (alias row), not every project of the sub.
CREATE OR REPLACE FUNCTION public.sync_project_conversation_participants(p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_conv_id uuid;
  v_owner_company uuid;
BEGIN
  SELECT id INTO v_conv_id FROM public.conversations WHERE project_id = p_project_id;
  IF v_conv_id IS NULL THEN RETURN; END IF;
  SELECT company_id INTO v_owner_company FROM public.projects WHERE id = p_project_id;

  INSERT INTO public.conversation_participants (conversation_id, user_id, company_id)
  SELECT v_conv_id, p.user_id, p.company_id
  FROM public.profiles p
  WHERE p.company_id = v_owner_company
  ON CONFLICT DO NOTHING;

  INSERT INTO public.conversation_participants (conversation_id, user_id, company_id)
  SELECT v_conv_id, p.user_id, p.company_id
  FROM public.project_connections pc
  JOIN public.profiles p ON p.company_id = pc.sub_company_id
  WHERE pc.project_id = p_project_id
  ON CONFLICT DO NOTHING;

  -- Guest GCs: only add if the guest company has an alias row for THIS project
  INSERT INTO public.conversation_participants (conversation_id, user_id, company_id)
  SELECT v_conv_id, p.user_id, p.company_id
  FROM public.guest_project_connections gpc
  JOIN public.profiles p ON p.company_id = gpc.guest_company_id
  JOIN public.project_aliases pa
    ON pa.project_id = p_project_id AND pa.company_id = gpc.guest_company_id
  WHERE gpc.sub_company_id = v_owner_company
  ON CONFLICT DO NOTHING;
END;
$function$;

-- 4. Clean up existing over-broad guest participant rows on project conversations.
--    Remove guest GC user participation from project chats where their company
--    has no alias row for that project.
DELETE FROM public.conversation_participants cp
USING public.conversations c,
      public.profiles p,
      public.companies gc
WHERE cp.conversation_id = c.id
  AND c.type = 'project'
  AND c.project_id IS NOT NULL
  AND p.user_id = cp.user_id
  AND gc.id = p.company_id
  AND gc.is_guest = true
  AND NOT EXISTS (
    SELECT 1 FROM public.project_aliases pa
    WHERE pa.project_id = c.project_id
      AND pa.company_id = p.company_id
  );
