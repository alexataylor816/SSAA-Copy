import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { EVENT } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

export interface ConversationSummary {
  id: string;
  type: "project" | "dm" | "group";
  projectId: string | null;
  subCompanyId: string | null;
  title: string;
  subtitle: string | null;
  lastMessageAt: string;
  lastMessage: { body: string; senderName: string | null; createdAt: string } | null;
  unreadCount: number;
  canPost: boolean;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderUserId: string | null;
  senderName: string | null;
  senderCompanyName: string | null;
  body: string;
  kind: string;
  createdAt: string;
}

export interface Contact {
  userId: string;
  fullName: string;
  email: string;
  companyName: string | null;
}

// The header badge and the Messages page each hold their own list; a read in
// one has to refresh the other, and the server sends no event for reads.
const READ_EVENT = "ssaa:messages-read";

export const messagingApi = {
  conversations: () => api.get<{ conversations: ConversationSummary[] }>("/conversations"),
  messages: (id: string) => api.get<{ messages: ChatMessage[] }>(`/conversations/${id}/messages`),
  send: (id: string, body: string) => api.post<{ message: ChatMessage }>(`/conversations/${id}/messages`, { body }),
  markRead: async (id: string) => {
    await api.post(`/conversations/${id}/read`);
    window.dispatchEvent(new Event(READ_EVENT));
  },
  openDm: (userId: string) => api.post<{ conversationId: string }>("/conversations/dm", { userId }),
  contacts: () => api.get<{ contacts: Contact[] }>("/messaging/contacts"),
};

/**
 * Every conversation the signed-in user is in, kept current by the
 * `message:created` event the server sends to each participant's own room.
 * `onMessage` lets an open thread append the message without refetching it.
 */
export function useConversations(onMessage?: (message: ChatMessage) => void) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await messagingApi.conversations();
      setConversations(res.conversations);
    } catch {
      // A failed refresh keeps the last good list rather than blanking it.
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
    const onRead = () => void refresh();
    window.addEventListener(READ_EVENT, onRead);
    return () => window.removeEventListener(READ_EVENT, onRead);
  }, [refresh]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`messaging-global-${userId}`)
      .on(EVENT.messageCreated, (payload) => {
        const message = (payload as { message?: ChatMessage }).message;
        if (message) onMessage?.(message);
        void refresh();
      })
      .subscribe();
    return () => channel.unsubscribe();
  }, [userId, refresh, onMessage]);

  const totalUnread = useMemo(() => conversations.reduce((sum, c) => sum + c.unreadCount, 0), [conversations]);

  return { conversations, totalUnread, loading, refresh };
}
