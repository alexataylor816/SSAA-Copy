CREATE OR REPLACE FUNCTION public.search_sub_companies_for_connection(p_query text DEFAULT ''::text, p_acting_company_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid, name text, address text, trade text, is_guest boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_exclude uuid;
BEGIN
  IF p_acting_company_id IS NOT NULL AND public.is_moa() THEN
    v_exclude := p_acting_company_id;
  ELSE
    v_exclude := public.get_user_company_id();
  END IF;

  RETURN QUERY
  SELECT c.id, c.name, c.address, c.trade, c.is_guest
  FROM public.companies c
  WHERE c.company_type = 'sub'
    AND c.id IS DISTINCT FROM v_exclude
    AND (COALESCE(p_query, '') = ''
         OR c.name ILIKE '%' || p_query || '%'
         OR c.trade ILIKE '%' || p_query || '%')
  ORDER BY c.name
  LIMIT 50;
END;
$function$;