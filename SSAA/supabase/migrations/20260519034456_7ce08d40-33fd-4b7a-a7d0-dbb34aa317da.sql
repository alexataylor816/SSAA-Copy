
INSERT INTO storage.buckets (id, name, public)
VALUES ('email-template-images', 'email-template-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Email template images are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'email-template-images');

CREATE POLICY "MOA can upload email template images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'email-template-images' AND public.is_moa());

CREATE POLICY "MOA can update email template images"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'email-template-images' AND public.is_moa());

CREATE POLICY "MOA can delete email template images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'email-template-images' AND public.is_moa());
