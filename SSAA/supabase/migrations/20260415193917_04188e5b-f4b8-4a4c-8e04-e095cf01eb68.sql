
-- Add profile_picture_url to employees
ALTER TABLE public.employees ADD COLUMN profile_picture_url text;

-- Add profile_picture_url to profiles
ALTER TABLE public.profiles ADD COLUMN profile_picture_url text;

-- Create profile-pictures storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('profile-pictures', 'profile-pictures', true);

-- Anyone can view profile pictures
CREATE POLICY "Public can view profile pictures"
ON storage.objects FOR SELECT
USING (bucket_id = 'profile-pictures');

-- Authenticated users can upload profile pictures
CREATE POLICY "Authenticated users can upload profile pictures"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'profile-pictures' AND auth.uid() IS NOT NULL);

-- Authenticated users can update their own profile pictures
CREATE POLICY "Authenticated users can update profile pictures"
ON storage.objects FOR UPDATE
USING (bucket_id = 'profile-pictures' AND auth.uid() IS NOT NULL);

-- Authenticated users can delete their own profile pictures
CREATE POLICY "Authenticated users can delete profile pictures"
ON storage.objects FOR DELETE
USING (bucket_id = 'profile-pictures' AND auth.uid() IS NOT NULL);
