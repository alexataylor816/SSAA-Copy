import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

interface PlanLimitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: 'project' | 'employee';
  planName?: string;
  current?: number;
  max?: number;
  onUpgrade?: () => void;
}

export function PlanLimitDialog({ open, onOpenChange, kind, planName, current, max, onUpgrade }: PlanLimitDialogProps) {
  const label = kind === 'project' ? 'projects' : 'employees';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Plan limit reached
          </DialogTitle>
          <DialogDescription>
            Your {planName ? `"${planName}"` : 'current'} plan allows {max ?? '—'} {label}.{' '}
            {typeof current === 'number' && <>You currently have <strong>{current}</strong>.</>}{' '}
            To add more, remove an existing {kind} or upgrade to a higher plan.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {onUpgrade && <Button onClick={onUpgrade}>Upgrade plan</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
