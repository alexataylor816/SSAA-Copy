import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Send, Paperclip, UserPlus, X } from 'lucide-react';
import { format } from 'date-fns';
import { markRead, type Message } from '@/hooks/useMessaging';
import SystemMessageCard from './SystemMessageCard';
import GroupAddParticipantModal from './GroupAddParticipantModal';
import SendChannelPromptDialog from './SendChannelPromptDialog';
import { sendNotification } from '@/hooks/useNotification';

interface Props {
  conversationId: string;
  label: string;
  isGroup: boolean;
  conversationType?: 'project' | 'dm' | 'group';
  readOnly?: boolean;
  onParticipantAdded?: () => void;
  readOnlyReason?: string;
  suppressReads?: boolean;
}

interface AttachmentPreview { file: File; url: string }

export default function ConversationThread({ conversationId, label, isGroup, conversationType, readOnly, onParticipantAdded, suppressReads }: Props) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [attachmentsByMessage, setAttachmentsByMessage] = useState<Record<string, { id: string; storage_path: string; mime_type: string | null }[]>>({});
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [senderNames, setSenderNames] = useState<Record<string, string>>({});
  const [body, setBody] = useState('');
  const [pending, setPending] = useState<AttachmentPreview[]>([]);
  const [sending, setSending] = useState(false);
  const [channelPromptOpen, setChannelPromptOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load messages
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    (async () => {
      const { data: msgs } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });
      if (cancelled) return;
      setMessages((msgs as any) || []);

      const msgIds = (msgs || []).map((m: any) => m.id);
      if (msgIds.length > 0) {
        const { data: att } = await supabase
          .from('message_attachments')
          .select('id, message_id, storage_path, mime_type')
          .in('message_id', msgIds);
        const byMsg: Record<string, any[]> = {};
        (att || []).forEach((a: any) => {
          if (!byMsg[a.message_id]) byMsg[a.message_id] = [];
          byMsg[a.message_id].push(a);
        });
        setAttachmentsByMessage(byMsg);
      }

      const senderIds = Array.from(new Set((msgs || []).map((m: any) => m.sender_user_id).filter(Boolean)));
      if (senderIds.length > 0) {
        const { data: profs } = await supabase.from('profiles').select('user_id, full_name, email').in('user_id', senderIds);
        const map: Record<string, string> = {};
        (profs || []).forEach((p) => { map[p.user_id] = p.full_name || p.email; });
        setSenderNames(map);
      }
    })();
    return () => { cancelled = true; };
  }, [conversationId]);

  // Realtime subscribe
  useEffect(() => {
    if (!conversationId || !user) return;
    const ch = supabase
      .channel(`conv-${conversationId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, async (payload) => {
        const m = payload.new as Message;
        setMessages((prev) => prev.some((x) => x.id === m.id) ? prev : [...prev, m]);
        if (!suppressReads) markRead(conversationId, user.id);
        if (m.sender_user_id && !senderNames[m.sender_user_id]) {
          const { data: p } = await supabase.from('profiles').select('full_name, email').eq('user_id', m.sender_user_id).maybeSingle();
          if (p) setSenderNames((prev) => ({ ...prev, [m.sender_user_id!]: p.full_name || p.email }));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [conversationId, user, senderNames, suppressReads]);

  // Sign attachment URLs
  useEffect(() => {
    const allPaths = Object.values(attachmentsByMessage).flat().map((a) => a.storage_path);
    const missing = allPaths.filter((p) => !signedUrls[p]);
    if (missing.length === 0) return;
    supabase.storage.from('message-attachments').createSignedUrls(missing, 3600).then(({ data }) => {
      if (!data) return;
      const next: Record<string, string> = {};
      data.forEach((d: any) => { if (d.signedUrl) next[d.path] = d.signedUrl; });
      setSignedUrls((prev) => ({ ...prev, ...next }));
    });
  }, [attachmentsByMessage, signedUrls]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setPending((prev) => [...prev, ...files.map((f) => ({ file: f, url: URL.createObjectURL(f) }))]);
    e.target.value = '';
  };

  const removePending = (i: number) => {
    setPending((prev) => prev.filter((_, idx) => idx !== i));
  };

  const requestSend = () => {
    if (!user || sending) return;
    if (!body.trim() && pending.length === 0) return;
    // Only prompt when there's message text; attachments-only skip prompt.
    if (body.trim()) {
      setChannelPromptOpen(true);
    } else {
      doSend({ email: false, sms: false });
    }
  };

  const broadcastToChannels = async (messageBody: string, choice: { email: boolean; sms: boolean }) => {
    if (!user) return;
    if (!choice.email && !choice.sms) return;
    try {
      const { data: parts } = await supabase
        .from('conversation_participants')
        .select('user_id')
        .eq('conversation_id', conversationId);
      const otherIds = (parts || []).map((p: any) => p.user_id).filter((id: string) => id !== user.id);
      if (otherIds.length === 0) return;

      const { data: profs } = await supabase
        .from('profiles')
        .select('user_id, email, phone, sms_consent, full_name, company_id')
        .in('user_id', otherIds);

      const emails = choice.email
        ? (profs || []).map((p: any) => p.email).filter((e: string | null) => !!e)
        : [];
      // Text messaging is retired: the "also send" option now delivers a push
      // notification to every other participant (the message itself already
      // lives in this conversation, so no duplicate People message is posted).
      const pushUserIds = choice.sms ? otherIds : [];

      if (emails.length === 0 && pushUserIds.length === 0) return;

      const senderName = senderNames[user.id] || user.email || 'Someone';
      await sendNotification({
        eventType: 'user_message_broadcast',
        recipientEmails: emails,
        recipientUserIds: pushUserIds,
        skipMessage: true,
        variables: {
          sender_name: senderName,
          conversation_label: label || 'a conversation',
          message_body: messageBody,
        },
      });
    } catch (e) {
      console.error('broadcast failed', e);
    }
  };

  const doSend = async (choice: { email: boolean; sms: boolean }) => {
    if (!user || sending) return;
    if (!body.trim() && pending.length === 0) return;
    const messageBody = body.trim();
    setSending(true);
    try {
      const { data: meCo } = await supabase.from('profiles').select('company_id').eq('user_id', user.id).maybeSingle();
      const { data: inserted, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_user_id: user.id,
          sender_company_id: meCo?.company_id || null,
          body: messageBody || null,
          kind: 'user',
        })
        .select()
        .single();
      if (error) throw error;

      for (const p of pending) {
        const path = `${user.id}/${inserted.id}/${Date.now()}-${p.file.name}`;
        const { error: upErr } = await supabase.storage.from('message-attachments').upload(path, p.file);
        if (upErr) continue;
        await supabase.from('message_attachments').insert({
          message_id: inserted.id,
          storage_path: path,
          mime_type: p.file.type,
          size_bytes: p.file.size,
        });
      }
      setBody('');
      setPending([]);

      if (messageBody && (choice.email || choice.sms)) {
        broadcastToChannels(messageBody, choice);
      }
    } catch (e: any) {
      console.error('send failed', e);
    } finally {
      setSending(false);
    }
  };


  return (
    <>
      <div className="border-b px-4 py-3 flex items-center justify-between bg-card">
        <h2 className="font-semibold">{label}</h2>
        {isGroup && (
          <Button size="sm" variant="ghost" onClick={() => setAddOpen(true)}>
            <UserPlus className="h-4 w-4 mr-1" /> Add
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div ref={scrollRef} className="p-4 space-y-3">
          {messages.map((m) => {
            const mine = m.sender_user_id === user?.id;
            const isSystem = m.kind !== 'user';
            if (isSystem) {
              return <SystemMessageCard key={m.id} message={m} />;
            }
            const senderName = m.sender_user_id ? senderNames[m.sender_user_id] || 'User' : '';
            const atts = attachmentsByMessage[m.id] || [];
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] rounded-lg px-3 py-2 ${mine ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                  {!mine && <div className="text-xs font-semibold mb-1 opacity-80">{senderName}</div>}
                  {m.body && <div className="whitespace-pre-wrap break-words text-sm">{m.body}</div>}
                  {atts.length > 0 && (
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      {atts.map((a) => {
                        const url = signedUrls[a.storage_path];
                        if (!url) return null;
                        const isImg = (a.mime_type || '').startsWith('image/');
                        return isImg ? (
                          <a key={a.id} href={url} target="_blank" rel="noreferrer">
                            <img src={url} alt="" className="rounded max-h-40 object-cover" />
                          </a>
                        ) : (
                          <a key={a.id} href={url} target="_blank" rel="noreferrer" className="underline text-xs">
                            Attachment
                          </a>
                        );
                      })}
                    </div>
                  )}
                  <div className="text-[10px] mt-1 opacity-60">{format(new Date(m.created_at), 'MMM d h:mm a')}</div>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {pending.length > 0 && (
        <div className="border-t p-2 flex gap-2 overflow-x-auto bg-muted/30">
          {pending.map((p, i) => (
            <div key={i} className="relative flex-shrink-0">
              {p.file.type.startsWith('image/') ? (
                <img src={p.url} alt="" className="h-16 w-16 object-cover rounded" />
              ) : (
                <div className="h-16 w-16 rounded bg-muted flex items-center justify-center text-xs px-1 text-center">{p.file.name}</div>
              )}
              <button onClick={() => removePending(i)} className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {readOnly ? (
        <div className="border-t p-3 text-center text-xs text-muted-foreground bg-card">
          You have view-only access to this project chat.
        </div>
      ) : (
        <div className="border-t p-3 flex gap-2 items-center bg-card">
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFilePick} accept="image/*,application/pdf" />
          <Button variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()}>
            <Paperclip className="h-4 w-4" />
          </Button>
          <Input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Type a message..."
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                requestSend();
              }
            }}
          />
          <Button onClick={requestSend} disabled={sending || (!body.trim() && pending.length === 0)}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      )}

      <GroupAddParticipantModal
        open={addOpen}
        onOpenChange={setAddOpen}
        conversationId={conversationId}
        onAdded={() => { setAddOpen(false); onParticipantAdded?.(); }}
      />

      <SendChannelPromptDialog
        open={channelPromptOpen}
        onOpenChange={setChannelPromptOpen}
        conversationType={conversationType || (isGroup ? 'group' : 'dm')}
        hasAttachments={pending.length > 0}
        onConfirm={(choice) => doSend(choice)}
      />
    </>
  );
}
