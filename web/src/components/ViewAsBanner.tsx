import { Eye, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { currentViewAs, exitViewAs, isReadOnlyViewAs, isViewingAs } from "@/lib/viewAs";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";

/** Luke's "Viewing as: Name (Company)" strip, on every page while an operator is viewing as someone. */
export default function ViewAsBanner() {
  const { t } = useLanguage();
  const { user } = useAuth();
  if (!user || !isViewingAs()) return null;
  const target = currentViewAs();
  const name = target?.name || user.fullName || user.email;
  const company = target?.companyName;

  return (
    <div
      role="status"
      className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground"
    >
      <Eye className="h-4 w-4 shrink-0" />
      <span className="truncate">
        
        {t("viewAsBanner.viewingAs")}{" "}{name}
        {company ? ` (${company})` : ""}
        {isReadOnlyViewAs() ? t("viewAsBanner.readOnly") : ""}
      </span>
      <Button
        size="sm"
        variant="secondary"
        className="h-7 shrink-0 gap-1 px-2"
        onClick={exitViewAs}
        aria-label={t("viewAsBanner.exitViewAs")}
      >
        <X className="h-3.5 w-3.5" />
        
        {t("viewAsBanner.exit")}
      </Button>
    </div>
  );
}
