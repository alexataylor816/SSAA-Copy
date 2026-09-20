-- 1. SECURITY DEFINER RPC to approve a join request, bypassing the
--    profiles.update RLS that requires company_id = get_user_company_id()
--    (which is broken when the requester's profile.company_id is NULL).
CREATE OR REPLACE FUNCTION public.approve_company_join_request(
  p_request_id uuid,
  p_default_permission permission_level DEFAULT 'standard'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req record;
  v_normalized_email text;
  v_linked_employee_id uuid;
  v_employee record;
BEGIN
  -- Load the request
  SELECT * INTO v_req
  FROM public.company_join_requests
  WHERE id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Join request % not found', p_request_id;
  END IF;

  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Join request % is not pending (status: %)', p_request_id, v_req.status;
  END IF;

  -- Authorization check
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

  v_normalized_email := lower(trim(v_req.user_email));

  -- 1. Update the requester's profile: set company_id (and normalize email casing if needed)
  UPDATE public.profiles
  SET 
    company_id = v_req.company_id,
    updated_at = now()
  WHERE user_id = v_req.user_id;

  -- 2. Try to find a pre-existing employee row by case-insensitive email
  SELECT * INTO v_employee
  FROM public.employees
  WHERE company_id = v_req.company_id
    AND linked_user_id IS NULL
    AND email IS NOT NULL
    AND lower(trim(email)) = v_normalized_email
  LIMIT 1;

  IF FOUND THEN
    v_linked_employee_id := v_employee.id;

    -- Link the employee record to this user
    UPDATE public.employees
    SET linked_user_id = v_req.user_id
    WHERE id = v_employee.id;

    -- Overwrite profile fields with admin-entered employee data when present
    UPDATE public.profiles
    SET 
      full_name = COALESCE(NULLIF(v_employee.name, ''), full_name),
      phone = COALESCE(NULLIF(v_employee.phone, ''), phone),
      email = COALESCE(NULLIF(v_employee.email, ''), email),
      updated_at = now()
    WHERE user_id = v_req.user_id;
  END IF;

  -- 3. Upsert user_roles row
  INSERT INTO public.user_roles (user_id, company_id, permission_level)
  VALUES (v_req.user_id, v_req.company_id, p_default_permission)
  ON CONFLICT (user_id, company_id) DO UPDATE
    SET permission_level = EXCLUDED.permission_level,
        updated_at = now();

  -- 4. Mark the join request approved
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
    'company_id', v_req.company_id
  );
END;
$$;

-- Some installations don't have the (user_id, company_id) unique constraint on user_roles.
-- Make sure the upsert above can succeed; if the constraint is missing we degrade gracefully.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_roles_user_id_company_id_key'
  ) THEN
    BEGIN
      ALTER TABLE public.user_roles
        ADD CONSTRAINT user_roles_user_id_company_id_key UNIQUE (user_id, company_id);
    EXCEPTION WHEN others THEN
      -- ignore; existing data may not be unique
      NULL;
    END;
  END IF;
END $$;

-- 2. Insert notification templates for approval and denial
INSERT INTO public.notification_templates (event_type, channel, subject, body_html, is_active, placeholder_variables, description)
VALUES
(
  'join_request_approved',
  'email',
  'You''ve been approved to join {company_name}',
  '<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">'
  || '<h2 style="color: #0284c7;">You''re in, {requester_name}!</h2>'
  || '<p>Good news — your request to join <strong>{company_name}</strong> on SSAA has been approved.</p>'
  || '<p>You can now log in to access your team''s calendar, availability, and schedule.</p>'
  || '<p style="margin: 28px 0;">'
  || '<a href="https://ssaainc.com" style="background-color: #0284c7; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600;">Log in to SSAA</a>'
  || '</p>'
  || '<p style="color: #6b7280; font-size: 14px;">If the button doesn''t work, paste this link into your browser: https://ssaainc.com</p>'
  || '</div>',
  true,
  ARRAY['company_name', 'requester_name'],
  'Sent to a user when their request to join a company is approved.'
),
(
  'join_request_denied',
  'email',
  'Update on your request to join {company_name}',
  '<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">'
  || '<h2 style="color: #111827;">Hi {requester_name},</h2>'
  || '<p>Thanks for your interest in joining <strong>{company_name}</strong> on SSAA.</p>'
  || '<p>Unfortunately, your request was not approved at this time.</p>'
  || '<p>If you believe this was a mistake, please reach out to the company directly so they can add you.</p>'
  || '<p style="color: #6b7280; font-size: 14px; margin-top: 24px;">— The SSAA Team</p>'
  || '</div>',
  true,
  ARRAY['company_name', 'requester_name'],
  'Sent to a user when their request to join a company is denied.'
);