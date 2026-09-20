-- Create storage bucket for schedule request images
INSERT INTO storage.buckets (id, name, public) 
VALUES ('schedule-request-images', 'schedule-request-images', true);

-- RLS policies for the storage bucket
CREATE POLICY "Authenticated users can upload schedule images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'schedule-request-images');

CREATE POLICY "Anyone authenticated can view schedule request images"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'schedule-request-images');

CREATE POLICY "Users can delete their uploaded schedule images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'schedule-request-images');

-- Add image_urls column to schedule_requests table
ALTER TABLE public.schedule_requests 
ADD COLUMN image_urls TEXT[] DEFAULT '{}';

-- Create function to check if user can manage projects (account_holder or full permission)
CREATE OR REPLACE FUNCTION public.can_manage_projects()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND company_id = get_user_company_id()
      AND permission_level IN ('account_holder', 'full')
  ) OR is_moa()
$$;