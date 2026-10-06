import { useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { getOpenConversation, useConversations, type ChatMessage } from "@/hooks/useMessaging";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

const BASE_TITLE = "SSAA";

/** A short two-note chime. Browsers keep audio muted until the page has had a click, which signing in provides. */
function playPing() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = [880, 1320];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = ctx.currentTime + i * 0.12;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.2);
    });
    setTimeout(() => void ctx.close(), 600);
  } catch {
    // No sound is fine; the toast and badge still show.
  }
}

/**
 * App-wide new-message alert: toast + chime when someone else messages you in a
 * conversation you don't have open, and the unread count in the tab title.
 * Mounted once (App.tsx) so it works on every page.
 */
export default function MessageAlerts() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const userId = user?.id ?? null;
  // Stable identity: useConversations re-subscribes its socket whenever this changes.
  const onMessage = useCallback(
    (message: ChatMessage) => {
      if (!userId || message.senderUserId === userId) return;
      if (message.conversationId === getOpenConversation()) return;
      playPing();
      const preview = message.body.length > 90 ? `${message.body.slice(0, 90)}…` : message.body;
      toast({
        title: `New message from ${message.senderName ?? "someone"}`,
        description: preview,
        action: (
          <ToastAction altText="Open the conversation" onClick={() => navigate(`/messages?c=${message.conversationId}`)}>
            Open
          </ToastAction>
        ),
      });
    },
    [userId, navigate],
  );
  const { totalUnread } = useConversations(onMessage);

  useEffect(() => {
    document.title = user && totalUnread > 0 ? `(${totalUnread > 99 ? "99+" : totalUnread}) ${BASE_TITLE}` : BASE_TITLE;
  }, [user, totalUnread]);

  return null;
}
