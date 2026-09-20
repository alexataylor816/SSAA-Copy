
DROP POLICY "Guest GCs can read own connections" ON public.guest_project_connections;
CREATE POLICY "Guest GCs can read own connections"
  ON public.guest_project_connections FOR SELECT
  USING (is_moa() OR (guest_company_id = get_user_company_id()));

DROP POLICY "Subs can read connections to them" ON public.guest_project_connections;
CREATE POLICY "Subs can read connections to them"
  ON public.guest_project_connections FOR SELECT
  USING (sub_company_id = get_user_company_id());
