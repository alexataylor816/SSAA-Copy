
-- Drop the single-column unique constraint on event_type
ALTER TABLE public.notification_templates DROP CONSTRAINT notification_templates_event_type_key;

-- Add composite unique constraint on (event_type, channel)
ALTER TABLE public.notification_templates ADD CONSTRAINT notification_templates_event_type_channel_key UNIQUE (event_type, channel);
