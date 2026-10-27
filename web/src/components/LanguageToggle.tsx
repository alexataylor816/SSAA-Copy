import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { authApi } from "@/lib/api";
import { isViewingAs } from "@/lib/viewAs";
import type { Language } from "@/i18n/translations";
import { cn } from "@/lib/utils";

/**
 * EN | ES switch. English is the default; the choice is remembered on this
 * device and, once signed in, saved on the profile so notifications, emails
 * and other devices follow it too.
 */
export default function LanguageToggle({
  tone = "default",
  className,
}: {
  /** "onPrimary" for the blue header and hero; "default" on light backgrounds. */
  tone?: "default" | "onPrimary";
  className?: string;
}) {
  const { language, setLanguage, t } = useLanguage();
  const { user } = useAuth();

  const choose = (lang: Language) => {
    if (lang === language) return;
    setLanguage(lang);
    // Saved quietly; a failed save still switches this screen.
    if (user && !isViewingAs()) void authApi.updateProfile({ language: lang }).catch(() => undefined);
  };

  const options: { value: Language; label: string; name: string }[] = [
    { value: "en", label: "EN", name: "English" },
    { value: "es", label: "ES", name: "Español" },
  ];

  return (
    <div
      role="group"
      aria-label={t("language.select")}
      className={cn(
        "flex items-center gap-0.5 rounded-lg p-0.5",
        tone === "onPrimary" ? "bg-primary-foreground/15" : "bg-muted",
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === language;
        return (
          <button
            key={o.value}
            type="button"
            lang={o.value}
            aria-pressed={active}
            aria-label={o.name}
            title={o.name}
            onClick={() => choose(o.value)}
            className={cn(
              "rounded-md px-2 py-1 text-xs font-semibold transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : tone === "onPrimary"
                  ? "text-primary-foreground/85 hover:text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
