-- Add metadata column to company_join_requests
ALTER TABLE public.company_join_requests
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Allow requester to cancel their own pending request via direct UPDATE
DROP POLICY IF EXISTS "Users can cancel own pending requests" ON public.company_join_requests;
CREATE POLICY "Users can cancel own pending requests"
ON public.company_join_requests
FOR UPDATE
USING (user_id = auth.uid() AND status = 'pending')
WITH CHECK (user_id = auth.uid());

-- Allow requester to delete their own pending request (cleanup)
DROP POLICY IF EXISTS "Users can delete own pending requests" ON public.company_join_requests;
CREATE POLICY "Users can delete own pending requests"
ON public.company_join_requests
FOR DELETE
USING (user_id = auth.uid() AND status = 'pending');

-- Replace approve_company_join_request to:
--  1) Enforce account-holder-only approval for GC target companies
--  2) Perform merge of guest company assets when metadata.merge=true AND requester is last member
CREATE OR REPLACE FUNCTION public.approve_company_join_request(
  p_request_id uuid,
  p_default_permission permission_level DEFAULT 'standard'::permission_level
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_req record;
  v_target_company record;
  v_normalized_email text;
  v_linked_employee_id uuid;
  v_employee record;
  v_merge boolean := false;
  v_source_guest_company_id uuid;
  v_guest_company record;
  v_guest_member_count integer := 0;
  v_target_company_name text;
  v_did_merge boolean := false;
  v_projects_moved integer := 0;
  v_subs_moved integer := 0;
BEGIN
  SELECT * INTO v_req FROM public.company_join_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Join request % not found', p_request_id;
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Join request % is not pending (status: %)', p_request_id, v_req.status;
  END IF;

  SELECT * INTO v_target_company FROM public.companies WHERE id = v_req.company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target company % not found', v_req.company_id;
  END IF;

  -- Authorization: GC companies require account_holder (or MOA). Subs keep partial+ behavior.
  IF v_target_company.company_type = 'gc' THEN
    IF NOT (public.is_moa() OR public.is_account_holder(v_req.company_id)) THEN
      RAISE EXCEPTION 'Only the main account holder can approve join requests for a GC company';
    END IF;
  ELSE
    IF NOT (
      public.is_moa()
      OR public.is_account_holder(v_req.company_id)
      OR (
        v_req.company_id = public.get_user_company_id()
        AND public.has_partial_or_higher()
      )
    ) THEN
      RAISE EXCEPTION 'Not authorized to approve join requests for this company';
    END IF;
  END IF;

  v_normalized_email := lower(trim(v_req.user_email));
  v_target_company_name := v_target_company.name;

  -- Read merge metadata
  v_merge := COALESCE((v_req.metadata->>'merge')::boolean, false);
  v_source_guest_company_id := NULLIF(v_req.metadata->>'source_guest_company_id', '')::uuid;

  -- If merge requested, verify guest company state at approval time
  IF v_merge AND v_source_guest_company_id IS NOT NULL THEN
    SELECT * INTO v_guest_company FROM public.companies WHERE id = v_source_guest_company_id;
    IF FOUND AND v_guest_company.is_guest = true THEN
      SELECT count(*) INTO v_guest_member_count
        FROM public.user_roles WHERE company_id = v_source_guest_company_id;
      IF v_guest_member_count = 1 THEN
        -- Re-parent projects owned by the guest company
        UPDATE public.projects
        SET company_id = v_target_company.id,
            owner_display_name = v_target_company_name,
            updated_at = now()
        WHERE company_id = v_source_guest_company_id;
        GET DIAGNOSTICS v_projects_moved = ROW_COUNT;

        -- Re-parent employee_project_assignments and user_project_assignments for those projects
        UPDATE public.employee_project_assignments
        SET company_id = v_target_company.id
        WHERE project_id IN (SELECT id FROM public.projects WHERE company_id = v_target_company.id)
          AND company_id = v_source_guest_company_id;

        UPDATE public.user_project_assignments
        SET company_id = v_target_company.id
        WHERE project_id IN (SELECT id FROM public.projects WHERE company_id = v_target_company.id)
          AND company_id = v_source_guest_company_id;

        -- Convert guest_project_connections to standard project_connections
        INSERT INTO public.project_connections (project_id, sub_company_id)
        SELECT p.id, gpc.sub_company_id
        FROM public.guest_project_connections gpc
        JOIN public.projects p ON p.company_id = v_target_company.id
        WHERE gpc.guest_company_id = v_source_guest_company_id
        ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS v_subs_moved = ROW_COUNT;

        DELETE FROM public.guest_project_connections
        WHERE guest_company_id = v_source_guest_company_id;

        v_did_merge := true;
      END IF;
    END IF;
  END IF;

  -- Update requester's profile: set new company_id
  UPDATE public.profiles
  SET company_id = v_req.company_id,
      updated_at = now()
  WHERE user_id = v_req.user_id;

  -- Remove the requester's old user_roles row(s) (e.g. account_holder on guest company)
  DELETE FROM public.user_roles
  WHERE user_id = v_req.user_id AND company_id IS DISTINCT FROM v_req.company_id;

  -- Try to find a pre-existing employee row by email
  SELECT * INTO v_employee
  FROM public.employees
  WHERE company_id = v_req.company_id
    AND linked_user_id IS NULL
    AND email IS NOT NULL
    AND lower(trim(email)) = v_normalized_email
  LIMIT 1;

  IF FOUND THEN
    v_linked_employee_id := v_employee.id;
    UPDATE public.employees SET linked_user_id = v_req.user_id WHERE id = v_employee.id;
    UPDATE public.profiles
    SET full_name = COALESCE(NULLIF(v_employee.name, ''), full_name),
        phone = COALESCE(NULLIF(v_employee.phone, ''), phone),
        email = COALESCE(NULLIF(v_employee.email, ''), email),
        updated_at = now()
    WHERE user_id = v_req.user_id;
  END IF;

  -- Upsert user_roles for the target company
  INSERT INTO public.user_roles (user_id, company_id, permission_level)
  VALUES (v_req.user_id, v_req.company_id, p_default_permission)
  ON CONFLICT (user_id, company_id) DO UPDATE
    SET permission_level = EXCLUDED.permission_level,
        updated_at = now();

  -- If merge happened, delete the now-empty guest company + its subscription
  IF v_did_merge THEN
    DELETE FROM public.company_subscriptions WHERE company_id = v_source_guest_company_id;
    DELETE FROM public.companies WHERE id = v_source_guest_company_id;
  END IF;

  UPDATE public.company_join_requests
  SET status = 'approved',
      reviewed_by = auth.uid(),
      updated_at = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'linked_employee_id', v_linked_employee_id,
    'requester_user_id', v_req.user_id,
    'requester_email', v_req.user_email,
    'requester_name', v_req.user_name,
    'company_id', v_req.company_id,
    'merged', v_did_merge,
    'projects_moved', v_projects_moved,
    'subs_moved', v_subs_moved
  );
END;
$function$;