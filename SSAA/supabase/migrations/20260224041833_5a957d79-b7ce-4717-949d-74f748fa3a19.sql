DROP POLICY "Users can update own profile" ON public.profiles;

CREATE POLICY "Users can update own profile or MOA can update any"
ON public.profiles
FOR UPDATE
USING (user_id = auth.uid() OR is_moa());