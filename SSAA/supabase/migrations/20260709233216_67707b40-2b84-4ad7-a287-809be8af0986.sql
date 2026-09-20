
-- Inbound SMS log
CREATE TABLE public.sms_inbound_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_phone text NOT NULL,
  to_phone text,
  body text,
  received_at timestamptz NOT NULL DEFAULT now(),
  matched_keyword text,
  response_event_type text,
  response_status text,
  twilio_message_sid text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sms_inbound_log TO authenticated;
GRANT ALL ON public.sms_inbound_log TO service_role;
ALTER TABLE public.sms_inbound_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "MOA can view sms inbound log"
  ON public.sms_inbound_log FOR SELECT
  TO authenticated
  USING (public.is_moa());

-- Suppressed phones (opted out)
CREATE TABLE public.suppressed_phones (
  phone text PRIMARY KEY,
  reason text,
  suppressed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.suppressed_phones TO authenticated;
GRANT ALL ON public.suppressed_phones TO service_role;
ALTER TABLE public.suppressed_phones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "MOA can view suppressed phones"
  ON public.suppressed_phones FOR SELECT
  TO authenticated
  USING (public.is_moa());

-- Seed SMS templates
INSERT INTO public.notification_templates (event_type, channel, subject, body_html, description, is_active, placeholder_variables)
VALUES
  (
    'sms_welcome_confirmation', 'sms', '',
    'Welcome to our text alerts! You are now enrolled to receive recurring automated updates. Message frequency varies. Message and data rates may apply. Reply HELP for help or STOP to cancel.',
    'Sent automatically the first time a user opts in to SSAA text alerts.',
    true, '{}'::text[]
  ),
  (
    'sms_help_response', 'sms', '',
    'SSAA Support: For help, email luke.aaron@ssaainc.com or call 301-793-5107. Message frequency varies. Message & data rates may apply. Reply STOP to cancel.',
    'Automated reply sent when a user texts HELP, INFO, or SUPPORT.',
    true, '{}'::text[]
  ),
  (
    'sms_optout_response', 'sms', '',
    'SSAA Support: You are unsubscribed from our automated messaging alerts. No more messages will be sent. Reply HELP for help or call 310-793-5107.',
    'Automated reply sent when a user texts STOP, UNSUBSCRIBE, END, QUIT, or HALT.',
    true, '{}'::text[]
  )
ON CONFLICT DO NOTHING;
