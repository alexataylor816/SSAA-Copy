-- Drop overly-permissive update/delete policies on profile-pictures
DROP POLICY IF EXISTS "Authenticated users can update profile pictures" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete profile pictures" ON storage.objects;

-- Helper: check if auth.uid() is the account holder for the company that owns the target user (path = users/{user_id}/...)
-- We inline the check using existing user_roles + profiles tables.

-- UPDATE: owner, account holder of owner's company, or MOA
CREATE POLICY "Profile pictures: owner, account holder, or MOA can update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'profile-pictures'
  AND (
    -- MOA
    public.is_moa()
    OR
    -- The user themselves (path is users/{user_id}/...)
    (storage.foldername(name))[1] = 'users'
    AND (storage.foldername(name))[2] = auth.uid()::text
    OR
    -- Account holder of the target user's company
    EXISTS (
      SELECT 1
      FROM public.profiles target
      JOIN public.user_roles ah
        ON ah.company_id = target.company_id
       AND ah.user_id = auth.uid()
       AND ah.permission_level = 'account_holder'
      WHERE (storage.foldername(name))[1] = 'users'
        AND target.user_id::text = (storage.foldername(name))[2]
    )
  )
)
WITH CHECK (
  bucket_id = 'profile-pictures'
  AND (
    public.is_moa()
    OR (
      (storage.foldername(name))[1] = 'users'
      AND (storage.foldername(name))[2] = auth.uid()::text
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles target
      JOIN public.user_roles ah
        ON ah.company_id = target.company_id
       AND ah.user_id = auth.uid()
       AND ah.permission_level = 'account_holder'
      WHERE (storage.foldername(name))[1] = 'users'
        AND target.user_id::text = (storage.foldername(name))[2]
    )
  )
);

-- DELETE: same scope as UPDATE
CREATE POLICY "Profile pictures: owner, account holder, or MOA can delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'profile-pictures'
  AND (
    public.is_moa()
    OR (
      (storage.foldername(name))[1] = 'users'
      AND (storage.foldername(name))[2] = auth.uid()::text
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles target
      JOIN public.user_roles ah
        ON ah.company_id = target.company_id
       AND ah.user_id = auth.uid()
       AND ah.permission_level = 'account_holder'
      WHERE (storage.foldername(name))[1] = 'users'
        AND target.user_id::text = (storage.foldername(name))[2]
    )
  )
);