-- 1. Push subscriptions (browser web push)
CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (endpoint)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own push subscriptions"
ON public.push_subscriptions FOR ALL TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE TRIGGER update_push_subscriptions_updated_at
BEFORE UPDATE ON public.push_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. In-app notifications (bell)
CREATE TABLE public.user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  event_type text NOT NULL,
  title text NOT NULL,
  body text,
  conversation_id uuid,
  project_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_notifications_user_created
ON public.user_notifications (user_id, created_at DESC);

GRANT SELECT, UPDATE, DELETE ON public.user_notifications TO authenticated;
GRANT ALL ON public.user_notifications TO service_role;

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own notifications"
ON public.user_notifications FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Users can update their own notifications"
ON public.user_notifications FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own notifications"
ON public.user_notifications FOR DELETE TO authenticated
USING (user_id = auth.uid());

-- 3. Copy SMS templates into push templates (idempotent)
INSERT INTO public.notification_templates
  (event_type, channel, subject, body_html, description, is_active, placeholder_variables, metadata)
SELECT s.event_type,
       'push',
       s.subject,
       s.body_html,
       s.description,
       true,
       s.placeholder_variables,
       COALESCE(s.metadata, '{}'::jsonb)
FROM public.notification_templates s
WHERE s.channel = 'sms'
  AND NOT EXISTS (
    SELECT 1 FROM public.notification_templates p
    WHERE p.channel = 'push' AND p.event_type = s.event_type
  );

-- 4. Resolve/create the direct (People) conversation between two users
CREATE OR REPLACE FUNCTION public.get_or_create_dm_conversation_between(
  p_sender_user_id uuid,
  p_recipient_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_sender_co uuid;
  v_recipient_co uuid;
BEGIN
  IF p_sender_user_id IS NULL OR p_recipient_user_id IS NULL THEN
    RAISE EXCEPTION 'sender and recipient are required';
  END IF;
  IF p_sender_user_id = p_recipient_user_id THEN
    RAISE EXCEPTION 'cannot DM yourself';
  END IF;

  SELECT c.id INTO v_id
  FROM public.conversations c
  WHERE c.type = 'dm'
    AND EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id = c.id AND user_id = p_sender_user_id)
    AND EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id = c.id AND user_id = p_recipient_user_id)
    AND (SELECT count(*) FROM public.conversation_participants WHERE conversation_id = c.id) = 2
  LIMIT 1;

  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT company_id INTO v_sender_co FROM public.profiles WHERE user_id = p_sender_user_id;
  SELECT company_id INTO v_recipient_co FROM public.profiles WHERE user_id = p_recipient_user_id;

  INSERT INTO public.conversations (type, created_by)
  VALUES ('dm', p_sender_user_id) RETURNING id INTO v_id;

  INSERT INTO public.conversation_participants (conversation_id, user_id, company_id) VALUES
    (v_id, p_sender_user_id, v_sender_co),
    (v_id, p_recipient_user_id, v_recipient_co);

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_or_create_dm_conversation_between(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_dm_conversation_between(uuid, uuid) TO service_role;