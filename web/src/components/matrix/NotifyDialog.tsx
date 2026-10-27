import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { NotifyChoice } from "@/lib/matrixApi";

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
          <DialogTitle>Notify General Contractors?</DialogTitle>
          <DialogDescription>
            You have newly assigned or moved employees. Do you want to notify the General Contractor(s) of these changes?
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {box("notify-gc-email", "Email", gcEmail, setGcEmail)}
          {box("notify-gc-push", "Push notification and message", gcPush, setGcPush)}
        </div>
        <div className="space-y-3 border-t py-2">
          <div>
            <p className="text-base font-semibold">Notify Personnel or Wait for GC Confirmation?</p>
            <p className="text-sm text-muted-foreground">Leave both unchecked to wait for GC confirmation.</p>
          </div>
          {box("notify-personnel-email", "Email", personnelEmail, setPersonnelEmail)}
          {box("notify-personnel-push", "Push notification and message", personnelPush, setPersonnelPush)}
        </div>
        <DialogFooter className="flex flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm({ gcEmail, gcPush, personnelEmail, personnelPush })}>Edit Schedule</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
