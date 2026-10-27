import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { NotifyChoice } from "@/lib/matrixApi";
import { useLanguage } from "@/contexts/LanguageContext";

/**
 * The sub's "Notify General Contractors?" step before publishing (O10), from Luke's MatrixDraftBar.
 * GC boxes start ticked; personnel boxes start empty ("wait for GC confirmation").
 */
export default function NotifyDialog({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: (choice: NotifyChoice) => void;
}) {
  const { t } = useLanguage();
  const [gcEmail, setGcEmail] = useState(true);
  const [gcPush, setGcPush] = useState(true);
  const [personnelEmail, setPersonnelEmail] = useState(false);
  const [personnelPush, setPersonnelPush] = useState(false);
  useEffect(() => {
    if (!open) return;
    setGcEmail(true);
    setGcPush(true);
    setPersonnelEmail(false);
    setPersonnelPush(false);
  }, [open]);

  const box = (id: string, label: string, checked: boolean, set: (v: boolean) => void) => (
    <div className="flex items-center space-x-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => set(!!v)} />
      <label htmlFor={id} className="cursor-pointer text-sm font-medium">
        {label}
      </label>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("notifyDialog.notifyGeneralContractors")}</DialogTitle>
          <DialogDescription>
            
            {t("notifyDialog.youHaveNewlyAssignedOrMoved")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {box("notify-gc-email", t("common.email"), gcEmail, setGcEmail)}
          {box("notify-gc-push", t("common.pushAndMessage"), gcPush, setGcPush)}
        </div>
        <div className="space-y-3 border-t py-2">
          <div>
            <p className="text-base font-semibold">{t("notifyDialog.notifyPersonnelOrWaitForGc")}</p>
            <p className="text-sm text-muted-foreground">{t("notifyDialog.leaveBothUncheckedToWaitFor")}</p>
          </div>
          {box("notify-personnel-email", t("common.email"), personnelEmail, setPersonnelEmail)}
          {box("notify-personnel-push", t("common.pushAndMessage"), personnelPush, setPersonnelPush)}
        </div>
        <DialogFooter className="flex flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={onCancel}>
            
            {t("common.cancel")}
          </Button>
          <Button onClick={() => onConfirm({ gcEmail, gcPush, personnelEmail, personnelPush })}>{t("notifyDialog.editSchedule")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
