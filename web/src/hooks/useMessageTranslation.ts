import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useLanguage } from "@/contexts/LanguageContext";

interface Translated {
  body: string;
  showing: boolean;
}

/**
 * The Translate button on chat messages. The server does the translating (and keeps each result), so
 * this only remembers which messages are showing their translation in the current language.
 */
export function useMessageTranslation() {
  const { language } = useLanguage();
  const [available, setAvailable] = useState(false);
  const [items, setItems] = useState<Record<string, Translated>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ available: boolean }>("/messages/translation")
      .then((r) => !cancelled && setAvailable(r.available))
      .catch(() => !cancelled && setAvailable(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const key = (id: string) => `${id}|${language}`;

  const toggle = useCallback(
    async (id: string) => {
      const k = `${id}|${language}`;
      const existing = items[k];
      if (existing) {
        setItems((prev) => ({ ...prev, [k]: { ...existing, showing: !existing.showing } }));
        return;
      }
      setBusy((prev) => ({ ...prev, [k]: true }));
      setFailed((prev) => {
        const next = { ...prev };
        delete next[k];
        return next;
      });
      try {
        const res = await api.post<{ body: string }>(`/messages/${id}/translate`, { to: language });
        setItems((prev) => ({ ...prev, [k]: { body: res.body, showing: true } }));
      } catch (err) {
        setFailed((prev) => ({ ...prev, [k]: err instanceof Error ? err.message : "" }));
      } finally {
        setBusy((prev) => ({ ...prev, [k]: false }));
      }
    },
    [items, language],
  );

  return {
    available,
    toggle,
    /** The translation to show instead of the original, if the reader asked for it. */
    shown: (id: string) => (items[key(id)]?.showing ? items[key(id)].body : null),
    isBusy: (id: string) => !!busy[key(id)],
    error: (id: string) => failed[key(id)] ?? null,
  };
}
