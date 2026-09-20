
-- Drop existing overly permissive storage policies for schedule-request-images
DROP POLICY IF EXISTS "Authenticated users can upload schedule images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone authenticated can view schedule request images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their uploaded schedule images" ON storage.objects;

-- INSERT: Users can only upload to their own company's folder
CREATE POLICY "Users can upload to own company folder" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'schedule-request-images'
    AND (storage.foldername(name))[1] = (get_user_company_id())::text
  );

-- SELECT: Users can view images from their own company's folder
-- OR images referenced by schedule_requests they are party to
CREATE POLICY "Users can view own or connected company images" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'schedule-request-images'
    AND (
      (storage.foldername(name))[1] = (get_user_company_id())::text
      OR is_moa()
      OR EXISTS (
        SELECT 1 FROM public.schedule_requests sr
        WHERE name = ANY(sr.image_urls)
          AND (sr.requesting_company_id = get_user_company_id() OR sr.sub_company_id = get_user_company_id())
      )
    )
  );

-- DELETE: Only the original uploader can delete
CREATE POLICY "Uploaders can delete own images" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'schedule-request-images'
    AND (owner = auth.uid() OR is_moa())
  );
