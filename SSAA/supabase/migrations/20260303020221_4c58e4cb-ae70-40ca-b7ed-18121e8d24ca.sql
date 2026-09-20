
-- Fix 1: Replace overly permissive notification_log INSERT policy
DROP POLICY IF EXISTS "System can insert logs" ON public.notification_log;

CREATE POLICY "Authenticated users can insert logs"
  ON public.notification_log FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Fix 2: Add deny-all policy to password_reset_codes for defense-in-depth
CREATE POLICY "No direct user access to reset codes"
  ON public.password_reset_codes
  FOR ALL
  USING (false);
