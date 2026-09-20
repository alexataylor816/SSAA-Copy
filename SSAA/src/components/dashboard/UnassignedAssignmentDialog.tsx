import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertTriangle } from 'lucide-react';

export interface UnassignedPair {
  employeeId: string;
  employeeName: string;
  jobTitle?: string | null;
  projectId: string;
  projectName: string;
  date?: string;
}

interface UnassignedAssignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pairs: UnassignedPair[];
  /** Called when the user confirms the temporary exception. */
  onConfirm: () => void;
  /** Called when the user cancels. */
  onCancel: () => void;
}

const UnassignedAssignmentDialog = ({
  open,
  onOpenChange,
  pairs,
  onConfirm,
  onCancel,
}: UnassignedAssignmentDialogProps) => {
  // Group pairs by employee for cleaner display
  const grouped = new Map<string, { name: string; jobTitle?: string | null; projects: Set<string> }>();
  pairs.forEach(p => {
    if (!grouped.has(p.employeeId)) {
      grouped.set(p.employeeId, { name: p.employeeName, jobTitle: p.jobTitle, projects: new Set() });
    }
    grouped.get(p.employeeId)!.projects.add(p.projectName);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Unassigned employee placement
          </DialogTitle>
          <DialogDescription>
            You've assigned one or more employees to a project they are not
            officially assigned to. Are you sure you want to proceed?
          </DialogDescription>
        </DialogHeader>

        <div className="text-sm space-y-3">
          <ScrollArea className="max-h-60 rounded-md border border-border p-3">
            <ul className="space-y-2">
              {Array.from(grouped.entries()).map(([empId, info]) => (
                <li key={empId} className="text-sm">
                  <span className="font-medium">{info.name}</span>
                  {info.jobTitle && (
                    <span className="text-muted-foreground"> – {info.jobTitle}</span>
                  )}
                  <span className="text-muted-foreground">
                    {' '}is not assigned to{' '}
                    <span className="text-foreground font-medium">
                      {Array.from(info.projects).join(', ')}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </ScrollArea>

          <div className="rounded-md bg-muted/50 border border-border p-3 text-xs text-muted-foreground space-y-1">
            <p>
              <strong className="text-foreground">This is a one-time exception.</strong>{' '}
              Confirming will only apply to this specific day/time/shift and{' '}
              <em>will not</em> permanently change the employee's project assignment.
            </p>
            <p>
              To permanently update which projects an employee is assigned to, go to{' '}
              <strong className="text-foreground">Manage Team Profiles</strong>.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              onCancel();
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            Yes, proceed with exception
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default UnassignedAssignmentDialog;
