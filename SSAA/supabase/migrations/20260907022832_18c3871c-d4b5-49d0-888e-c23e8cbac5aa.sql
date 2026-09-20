REVOKE EXECUTE ON FUNCTION public.list_company_contact_candidates(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_company_contact_candidates(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_company_contact_candidates(uuid, uuid) TO authenticated;