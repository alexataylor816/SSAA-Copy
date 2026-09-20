
REVOKE ALL ON FUNCTION public.contact_eligible_users(uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.link_company_contacts(uuid, uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_project_cross_company_contacts(uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_contacts_for_company_projects(uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_sync_project_contacts() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_sync_guest_connection_contacts() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_sync_user_contacts() FROM anon, authenticated;
