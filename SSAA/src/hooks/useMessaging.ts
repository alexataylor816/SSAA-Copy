import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface Conversation {
  id: string;
  type: 'project' | 'dm' | 'group';
  project_id: string | null;
  sub_company_id?: string | null;
  title: string | null;
  last_message_at: string;
  created_by: string | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_user_id: string | null;
  sender_company_id: string | null;
  body: string | null;
  kind: string;
  metadata: any;
  created_at: string;
}

export interface ParticipantRow {
  id: string;
  conversation_id: string;
  user_id: string;
  company_id: string | null;
}

/**
 * Pulls all conversations the current user participates in, plus unread counts.
 */
export function useConversations(effectiveUserId?: string | null) {
  const { user: authUser } = useAuth();
  const viewerId = effectiveUserId ?? authUser?.id ?? null;
  const user = viewerId ? ({ id: viewerId } as { id: string }) : null;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [reads, setReads] = useState<Record<string, string>>({});
  const [lastMessages, setLastMessages] = useState<Record<string, Message>>({});
  const [unreadByConv, setUnreadByConv] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const { data: parts } = await supabase
      .from('conversation_participants')
      .select('conversation_id')
      .eq('user_id', user.id);
    const ids = (parts || []).map((p) => p.conversation_id);
    if (ids.length === 0) {
      setConversations([]);
      setReads({});
      setLastMessages({});
      setUnreadByConv({});
      setLoading(false);
      return;
    }

    const [{ data: convs }, { data: readRows }, { data: msgs }] = await Promise.all([
      supabase.from('conversations').select('*').in('id', ids).order('last_message_at', { ascending: false }),
      supabase.from('message_reads').select('conversation_id, last_read_at').eq('user_id', user.id),
      supabase.from('messages').select('*').in('conversation_id', ids).order('created_at', { ascending: false }).limit(500),
    ]);

    const readsMap: Record<string, string> = {};
    (readRows || []).forEach((r: any) => {
      readsMap[r.conversation_id] = r.last_read_at;
    });

    const lastMsg: Record<string, Message> = {};
    const unread: Record<string, number> = {};
    (msgs || []).forEach((m: any) => {
      if (!lastMsg[m.conversation_id]) lastMsg[m.conversation_id] = m;
      const cutoff = readsMap[m.conversation_id];
      if ((!cutoff || m.created_at > cutoff) && m.sender_user_id !== user.id) {
        unread[m.conversation_id] = (unread[m.conversation_id] || 0) + 1;
      }
    });

    setConversations((convs as any) || []);
    setReads(readsMap);
    setLastMessages(lastMsg);
    setUnreadByConv(unread);
    setLoading(false);
  }, [viewerId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Realtime: new messages bump conversations + unread counts
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`messaging-global-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const m = payload.new as Message;
        // Only react if we are a participant (we don't subscribe per-conversation here)
        setLastMessages((prev) => {
          const existing = prev[m.conversation_id];
          if (existing && existing.created_at > m.created_at) return prev;
          return { ...prev, [m.conversation_id]: m };
        });
        setConversations((prev) => {
          const found = prev.find((c) => c.id === m.conversation_id);
          if (!found) {
            // refetch to pick up new conversation
            fetchAll();
            return prev;
          }
          const updated = { ...found, last_message_at: m.created_at };
          return [updated, ...prev.filter((c) => c.id !== m.conversation_id)];
        });
        if (m.sender_user_id !== user.id) {
          setUnreadByConv((prev) => ({ ...prev, [m.conversation_id]: (prev[m.conversation_id] || 0) + 1 }));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reads', filter: `user_id=eq.${user.id}` }, (payload: any) => {
        const r = payload.new || payload.old;
        if (r?.conversation_id) {
          setReads((prev) => ({ ...prev, [r.conversation_id]: r.last_read_at }));
          setUnreadByConv((prev) => ({ ...prev, [r.conversation_id]: 0 }));
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversation_participants', filter: `user_id=eq.${user.id}` }, () => {
        fetchAll();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [viewerId, fetchAll]);

  const totalUnread = useMemo(() => Object.values(unreadByConv).reduce((a, b) => a + b, 0), [unreadByConv]);

  return { conversations, lastMessages, unreadByConv, totalUnread, loading, refresh: fetchAll, reads };
}

export async function markRead(conversationId: string, userId: string) {
  await supabase
    .from('message_reads')
    .upsert({ conversation_id: conversationId, user_id: userId, last_read_at: new Date().toISOString() });
}
