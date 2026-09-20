
-- Allow company members to view profiles of users in the same company
-- This is needed for notification routing (finding emails/phones of assigned users)
CREATE POLICY "Company members can view company profiles"
  ON public.profiles
  FOR SELECT
  USING (company_id = get_user_company_id());
