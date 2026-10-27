import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { BatchResult } from "@/lib/matrixApi";

/** Luke's "Unassigned employee placement" exception dialog (O9), wording as in his app. */
export default function UnassignedDialog({
  open,
  pairs,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  pairs: BatchResult["unassigned"];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const grouped = new Map<string, { name: string; jobTitle: string | null; projects: Set<string> }>();
  for (const p of pairs) {
    const entry = grouped.get(p.employeeId) ?? { name: p.employeeName, jobTitle: p.jobTitle, projects: new Set<string>() };
    entry.projects.add(p.projectName);
    grouped.set(p.employeeId, entry);
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Unassigned employee placement
          </DialogTitle>
          <DialogDescription>
            You&apos;ve assigned one or more employees to a project they are not officially assigned to. Are you sure you want to
            proceed?
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <ul className="max-h-60 space-y-2 overflow-y-auto rounded-md border p-3">
            {[...grouped.entries()].map(([id, info]) => (
              <li key={id}>
                <span className="font-medium">{info.name}</span>
                {info.jobTitle && <span className="text-muted-foreground"> – {info.jobTitle}</span>}
                <span className="text-muted-foreground"> is not assigned to </span>
                <span className="font-medium">{[...info.projects].join(", ")}</span>
              </li>
            ))}
          </ul>
          <div className="space-y-1 rounded-md border bg-muted/50 p-3 text-xs text-muted-foreground">
            <p>
              <strong className="text-foreground">This is a one-time exception.</strong> Confirming will only apply to this specific
              day/time/shift and <em>will not</em> permanently change the employee&apos;s project assignment.
            </p>
            <p>
              To permanently update which projects an employee is assigned to, go to{" "}
              <strong className="text-foreground">Project assignments</strong> in Manage My Company Account.
            </p>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Yes, proceed with exception
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
