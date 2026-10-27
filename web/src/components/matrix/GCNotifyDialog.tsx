import { Bell, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { NotifyChoice } from "@/lib/matrixApi";

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
  const who =
    subNames.length === 0 ? "The subcontractor" : subNames.length === 1 ? subNames[0] : `${subNames.slice(0, -1).join(", ")} and ${subNames[subNames.length - 1]}`;
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
          <DialogTitle>Notify the subcontractor?</DialogTitle>
          <DialogDescription>
            {who} will receive a request to confirm <span className="font-semibold text-foreground">{count}</span> assignment
            {count !== 1 ? "s" : ""}
            {dateRange ? ` for ${dateRange}` : ""}. How should we notify them?
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-2 py-2 sm:grid-cols-2">
          {option("Email only", "Send via email", <Mail className="mr-2 h-4 w-4 text-primary" />, () => choose(true, false))}
          {option("Push only", "Push notification and message", <Bell className="mr-2 h-4 w-4 text-primary" />, () => choose(false, true))}
          {option(
            "Both",
            "Email and push notification",
            <span className="mr-2 flex items-center">
              <Mail className="h-4 w-4 text-primary" />
              <Bell className="-ml-1 h-4 w-4 text-primary" />
            </span>,
            () => choose(true, true),
          )}
          {option("In-app only", "No message sent", <Bell className="mr-2 h-4 w-4 text-muted-foreground" />, () => choose(false, false))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
