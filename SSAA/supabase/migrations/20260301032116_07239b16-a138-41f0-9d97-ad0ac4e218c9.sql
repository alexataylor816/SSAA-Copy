
-- Table for storing password reset codes
CREATE TABLE public.password_reset_codes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes'),
  used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only accessed via service role in edge functions, no public access
ALTER TABLE public.password_reset_codes ENABLE ROW LEVEL SECURITY;

-- Index for lookups
CREATE INDEX idx_password_reset_codes_email ON public.password_reset_codes (email, used, expires_at);

-- Insert password reset email template into notification_templates
INSERT INTO public.notification_templates (event_type, channel, subject, body_html, description, is_active, placeholder_variables)
VALUES (
  'password_reset',
  'email',
  'Your Password Reset Code',
  'Hi,

Your password reset verification code is: {code}

This code expires in 15 minutes. If you did not request a password reset, please ignore this email.',
  'Sent when a user requests a password reset. Contains a 6-digit verification code.',
  true,
  ARRAY['code', 'email']
);
