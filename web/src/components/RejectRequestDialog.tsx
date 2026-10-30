import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/contexts/LanguageContext";
import { tr } from "@/i18n/runtime";

interface RejectRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string | undefined) => void;
  mode?: "reject" | "remove-cancel";
}

export default function RejectRequestDialog({
  open,
  onOpenChange,
  onConfirm,
  mode = "reject",
}: RejectRequestDialogProps) {
  const { t } = useLanguage();
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  function handleConfirm() {
    const trimmed = reason.trim();
    onConfirm(trimmed ? trimmed : undefined);
  }

  const isRemove = mode === "remove-cancel";
  const title = isRemove ? t("rejectRequestDialog.removeCancelScheduleRequest") : t("rejectRequestDialog.rejectScheduleRequest");
  const description = isRemove
    ? t("rejectRequestDialog.thisCancelsThePendingRequestEntirely")
    : t("rejectRequestDialog.optionallyLetTheOtherPartyKnow");
  const confirmLabel = isRemove ? t("rejectRequestDialog.removeCancelRequest") : t("rejectRequestDialog.rejectRequest");
  const placeholder = isRemove ? tr("rejectRequestDialog.reasonForCancellation") : tr("rejectRequestDialog.reasonForRejection");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="rejection-reason">{t("rejectRequestDialog.reasonOptional")}</Label>
          <Textarea
            id="rejection-reason"
            placeholder={placeholder}
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={handleConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
