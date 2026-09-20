import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Mail, Bell } from 'lucide-react';

interface NotifyOnAssignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Summary like "Drywall Bros" or "2 subcontractors" */
  subSummary: string;
  /** Number of new/edited assignments */
  assignmentCount: number;
  /** Optional date range label (e.g. "Apr 20 – Apr 24") */
  dateRangeLabel?: string;
  onChoose: (notify: { email: boolean; sms: boolean }) => void;
}

const NotifyOnAssignDialog = ({
  open,
  onOpenChange,
  subSummary,
  assignmentCount,
  dateRangeLabel,
  onChoose,
}: NotifyOnAssignDialogProps) => {
  const handleChoose = (email: boolean, sms: boolean) => {
    onOpenChange(false);
    onChoose({ email, sms });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Notify the subcontractor?</DialogTitle>
          <DialogDescription>
            {subSummary} will receive a request to confirm{' '}
            <span className="font-semibold text-foreground">{assignmentCount}</span>{' '}
            assignment{assignmentCount !== 1 ? 's' : ''}
            {dateRangeLabel ? ` for ${dateRangeLabel}` : ''}. How should we notify them?
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 py-2">
          <Button
            variant="outline"
            className="justify-start h-auto py-3"
            onClick={() => handleChoose(true, false)}
          >
            <Mail className="h-4 w-4 mr-2 text-primary" />
            <div className="flex flex-col items-start">
              <span className="font-medium">Email only</span>
              <span className="text-xs text-muted-foreground">Send via email</span>
            </div>
          </Button>
          <Button
            variant="outline"
            className="justify-start h-auto py-3"
            onClick={() => handleChoose(false, true)}
          >
            <Bell className="h-4 w-4 mr-2 text-primary" />
            <div className="flex flex-col items-start">
              <span className="font-medium">Push only</span>
              <span className="text-xs text-muted-foreground">Push notification and message</span>
            </div>
          </Button>
          <Button
            variant="outline"
            className="justify-start h-auto py-3"
            onClick={() => handleChoose(true, true)}
          >
            <div className="flex items-center mr-2">
              <Mail className="h-4 w-4 text-primary" />
              <Bell className="h-4 w-4 -ml-1 text-primary" />
            </div>
            <div className="flex flex-col items-start">
              <span className="font-medium">Both</span>
              <span className="text-xs text-muted-foreground">Email and push notification</span>
            </div>
          </Button>
          <Button
            variant="outline"
            className="justify-start h-auto py-3"
            onClick={() => handleChoose(false, false)}
          >
            <Bell className="h-4 w-4 mr-2 text-muted-foreground" />
            <div className="flex flex-col items-start">
              <span className="font-medium">In-app only</span>
              <span className="text-xs text-muted-foreground">No message sent</span>
            </div>
          </Button>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default NotifyOnAssignDialog;
