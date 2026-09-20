DROP POLICY IF EXISTS "Update schedule requests" ON public.schedule_requests;
CREATE POLICY "Update schedule requests"
ON public.schedule_requests
FOR UPDATE
TO public
USING (
  is_moa()
  OR (
    has_partial_or_higher()
    AND (
      requesting_company_id = get_user_company_id()
      OR sub_company_id = get_user_company_id()
      OR intermediary_company_id = get_user_company_id()
      OR owns_project(project_id)
    )
  )
)
WITH CHECK (
  is_moa()
  OR (
    has_partial_or_higher()
    AND (
      requesting_company_id = get_user_company_id()
      OR sub_company_id = get_user_company_id()
      OR intermediary_company_id = get_user_company_id()
      OR owns_project(project_id)
    )
  )
);