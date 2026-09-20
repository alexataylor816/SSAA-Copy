
-- 1. Account holder guard: prevent deleting sole account holder
CREATE OR REPLACE FUNCTION public.guard_account_holder_deletion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = OLD.user_id AND permission_level = 'account_holder'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.company_id = OLD.company_id
        AND ur.permission_level = 'account_holder'
        AND ur.user_id != OLD.user_id
    ) THEN
      RAISE EXCEPTION 'Cannot delete the sole account holder. Please designate a new account holder first.';
    END IF;
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER guard_account_holder_before_delete
  BEFORE DELETE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_account_holder_deletion();

-- 2. Allow profiles to be deleted (add RLS policy)
CREATE POLICY "MOA can delete profiles"
  ON public.profiles
  FOR DELETE
  TO public
  USING (is_moa());
