-- 1) gc_invite_prefills table
CREATE TABLE public.gc_invite_prefills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  sub_company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  gc_company_name text NOT NULL,
  project_name text NOT NULL,
  project_address text,
  invitee_full_name text NOT NULL,
  invitee_email text NOT NULL,
  invitee_phone text,
  invitee_job_title text,
  accepted_at timestamptz,
  created_company_id uuid,
  created_project_id uuid,
  created_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_gc_invite_prefills_token ON public.gc_invite_prefills(invite_token);
CREATE INDEX idx_gc_invite_prefills_sub ON public.gc_invite_prefills(sub_company_id);

ALTER TABLE public.gc_invite_prefills ENABLE ROW LEVEL SECURITY;

-- Subs can insert their own prefills
CREATE POLICY "Subs can create own prefills"
  ON public.gc_invite_prefills
  FOR INSERT
  WITH CHECK (is_moa() OR sub_company_id = get_user_company_id());

-- Subs can read their own prefills; MOA can read all
CREATE POLICY "Subs can read own prefills"
  ON public.gc_invite_prefills
  FOR SELECT
  USING (is_moa() OR sub_company_id = get_user_company_id());

-- Anyone (including anon) can read by token (token is the secret)
CREATE POLICY "Anyone can read by token"
  ON public.gc_invite_prefills
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- MOA / service role can update (acceptance stamping handled by edge function with service role which bypasses RLS)
CREATE POLICY "MOA can update prefills"
  ON public.gc_invite_prefills
  FOR UPDATE
  USING (is_moa());

-- MOA can delete
CREATE POLICY "MOA can delete prefills"
  ON public.gc_invite_prefills
  FOR DELETE
  USING (is_moa());

-- 2) tour_seen flag on profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS tour_seen boolean NOT NULL DEFAULT false;