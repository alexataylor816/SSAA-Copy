
-- Fix 1: tighten message-attachments storage SELECT policy to conversation participants only
DROP POLICY IF EXISTS "Read message attachments" ON storage.objects;
CREATE POLICY "Read message attachments"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'message-attachments'
  AND (
    public.is_moa()
    OR EXISTS (
      SELECT 1
      FROM public.message_attachments ma
      JOIN public.messages m ON m.id = ma.message_id
      WHERE ma.storage_path = storage.objects.name
        AND public.is_conversation_participant(m.conversation_id)
    )
  )
);

-- Fix 2: add chat-sync trigger for guest_project_connections (symmetric to project_connections)
DROP TRIGGER IF EXISTS trg_guest_project_connections_chat_sync ON public.guest_project_connections;
CREATE TRIGGER trg_guest_project_connections_chat_sync
AFTER INSERT OR DELETE ON public.guest_project_connections
FOR EACH ROW EXECUTE FUNCTION public.tg_sync_project_chat_on_conn_change();
