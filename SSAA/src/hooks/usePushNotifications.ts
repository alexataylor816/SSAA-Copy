import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/** Public VAPID key — safe to ship in the client. */
const VAPID_PUBLIC_KEY =
  'BAPhoJ4ANTvVqRyrMgXbB3pxi3xqL60PBrpqbsCMJ9GvQKd-tkAjDqp9LNX5NG8gkUsfvFCbCMioUhXjjtQHd7o';

const PROMPT_FLAG = 'ssaa_push_prompted';

function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output as unknown as BufferSource;
}

const pushSupported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

/**
 * Registers the service worker and (once per user/device) asks for browser
 * push permission. Users who decline still receive the in-app bell
 * notification and the message in the People section of Messages.
 */
export const usePushNotifications = (userId: string | null | undefined) => {
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    pushSupported() ? Notification.permission : 'unsupported'
  );

  const subscribe = useCallback(async () => {
    if (!pushSupported() || !userId) return false;
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      let perm = Notification.permission;
      if (perm === 'default') {
        perm = await Notification.requestPermission();
        setPermission(perm);
      }
      if (perm !== 'granted') return false;

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }

      const json: any = sub.toJSON();
      if (!json?.keys?.p256dh || !json?.keys?.auth) return false;

      await supabase.from('push_subscriptions').upsert(
        {
          user_id: userId,
          endpoint: json.endpoint,
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
          user_agent: navigator.userAgent.slice(0, 300),
        },
        { onConflict: 'endpoint' }
      );
      return true;
    } catch (e) {
      console.warn('[push] subscribe failed', e);
      return false;
    }
  }, [userId]);

  // Ask once per user per device; silently re-sync if already granted.
  useEffect(() => {
    if (!pushSupported() || !userId) return;
    const key = `${PROMPT_FLAG}_${userId}`;
    if (Notification.permission === 'granted') {
      subscribe();
      return;
    }
    if (Notification.permission === 'default' && !localStorage.getItem(key)) {
      localStorage.setItem(key, '1');
      // Delay slightly so it doesn't collide with app bootstrap dialogs.
      const timer = setTimeout(() => { subscribe(); }, 4000);
      return () => clearTimeout(timer);
    }
  }, [userId, subscribe]);

  return { permission, subscribe, supported: pushSupported() };
};
