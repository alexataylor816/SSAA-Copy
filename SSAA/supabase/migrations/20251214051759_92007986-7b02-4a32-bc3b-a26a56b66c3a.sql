-- Allow deletion of schedule requests by MOA, requesting company, or subcontractor
CREATE POLICY "Delete schedule requests"
ON public.schedule_requests
FOR DELETE
TO public
USING (
  is_moa() 
  OR requesting_company_id = get_user_company_id() 
  OR sub_company_id = get_user_company_id()
);