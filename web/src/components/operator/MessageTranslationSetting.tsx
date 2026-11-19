import { useEffect, useState } from "react";
import { Languages } from "lucide-react";
import { api } from "@/lib/api";
import type { PlatformSettings } from "@/lib/operatorApi";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";

/**
 * Manage SSAA → "Message translation": turns the Traducir/Translate button in Messages on or off for
 * everyone, so the client can stop AI costs. Already-translated messages stay readable.
 */
export default function MessageTranslationSetting({ canChange }: { canChange: boolean }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [aiConfigured, setAiConfigured] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api
      .get<{ settings: PlatformSettings; aiConfigured: boolean }>("/admin/settings")
      .then((r) => {
        setSettings(r.settings);
        setAiConfigured(r.aiConfigured);
      })
      .catch(() => undefined);
  }, []);

  async function toggle(on: boolean) {
    setSaving(true);
    try {
      const r = await api.patch<{ settings: PlatformSettings; aiConfigured: boolean }>("/admin/settings", { messageTranslationEnabled: on });
      setSettings(r.settings);
      toast({ title: on ? t("messageTranslationSetting.turnedOn") : t("messageTranslationSetting.turnedOff") });
    } catch (err) {
      toast({ title: t("common.couldnTSave"), description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const on = settings?.messageTranslationEnabled ?? false;
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-4 text-left shadow-sm">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Languages className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <label htmlFor="message-translation-switch" className="block font-medium">
          {t("messageTranslationSetting.title")}
        </label>
        <span className="block text-sm text-muted-foreground">{t("messageTranslationSetting.explanation")}</span>
        {!aiConfigured && <span className="mt-1 block text-xs text-muted-foreground">{t("messageTranslationSetting.noKey")}</span>}
      </span>
      <Switch
        id="message-translation-switch"
        checked={on}
        disabled={!canChange || saving || settings == null}
        onCheckedChange={(v) => void toggle(v)}
      />
    </div>
  );
}
