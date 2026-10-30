import { Bell, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { NotifyChoice } from "@/lib/matrixApi";
import { useLanguage } from "@/contexts/LanguageContext";

/** The GC's "Notify the subcontractor?" choice before sending (O10), from Luke's NotifyOnAssignDialog. */
export default function GCNotifyDialog({
  open,
  subNames,
  count,
  dateRange,
  onCancel,
  onChoose,
}: {
  open: boolean;
  subNames: string[];
  count: number;
  dateRange: string | null;
  onCancel: () => void;
  onChoose: (choice: NotifyChoice) => void;
}) {
  const { t } = useLanguage();
  const who =
    subNames.length === 0 ? t("gCNotifyDialog.theSubcontractor") : subNames.length === 1 ? subNames[0] : t("gCNotifyDialog.namesAnd", { names: subNames.slice(0, -1).join(", "), last: subNames[subNames.length - 1] });
  const choose = (gcEmail: boolean, gcPush: boolean) => onChoose({ gcEmail, gcPush, personnelEmail: false, personnelPush: false });
  const option = (title: string, hint: string, icon: React.ReactNode, onClick: () => void) => (
    <Button variant="outline" className="h-auto min-w-0 items-start justify-start whitespace-normal py-3 text-left" onClick={onClick}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="flex min-w-0 flex-col items-start">
        <span className="font-medium">{title}</span>
        <span className="text-xs font-normal text-muted-foreground">{hint}</span>
      </div>
    </Button>
  );
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("gCNotifyDialog.notifyTheSubcontractor")}</DialogTitle>
          <DialogDescription>
            {who} {" "}{t("gCNotifyDialog.willReceiveARequestToConfirm")}{" "}<span className="font-semibold text-foreground">{count}</span>{" "}
            {t(count === 1 ? "gCNotifyDialog.assignment.one" : "gCNotifyDialog.assignment.other")}
            {dateRange ? t("gCNotifyDialog.for", { dateRange: dateRange }) : ""}{t("gCNotifyDialog.howShouldWeNotifyThem")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-2 py-2 sm:grid-cols-2">
          {option(t("gCNotifyDialog.emailOnly"), t("gCNotifyDialog.sendViaEmail"), <Mail className="mr-2 h-4 w-4 text-primary" />, () => choose(true, false))}
          {option(t("gCNotifyDialog.pushOnly"), t("common.pushAndMessage"), <Bell className="mr-2 h-4 w-4 text-primary" />, () => choose(false, true))}
          {option(
            t("gCNotifyDialog.both"),
            t("gCNotifyDialog.emailAndPush"),
            <span className="mr-2 flex items-center">
              <Mail className="h-4 w-4 text-primary" />
              <Bell className="-ml-1 h-4 w-4 text-primary" />
            </span>,
            () => choose(true, true),
          )}
          {option(t("gCNotifyDialog.inAppOnly"), t("gCNotifyDialog.noMessageSent"), <Bell className="mr-2 h-4 w-4 text-muted-foreground" />, () => choose(false, false))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            
            {t("common.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
