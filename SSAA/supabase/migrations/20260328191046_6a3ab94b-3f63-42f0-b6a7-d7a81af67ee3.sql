CREATE POLICY "Account holders can delete own pending requests"
ON public.company_deletion_requests
FOR DELETE
TO authenticated
USING (
  company_id = get_user_company_id()
  AND is_account_holder(company_id)
  AND status = 'pending'
);