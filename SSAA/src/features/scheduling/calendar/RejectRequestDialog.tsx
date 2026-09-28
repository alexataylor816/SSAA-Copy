import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

interface RejectRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string | undefined) => void;
  mode?: 'reject' | 'remove-cancel';
}

const RejectRequestDialog = ({ open, onOpenChange, onConfirm, mode = 'reject' }: RejectRequestDialogProps) => {
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  const handleConfirm = () => {
    const trimmed = reason.trim();
    onConfirm(trimmed ? trimmed : undefined);
  };

  const isRemove = mode === 'remove-cancel';
  const title = isRemove ? 'Remove & Cancel Schedule Request' : 'Reject Schedule Request';
  const description = isRemove
    ? 'This cancels the pending request entirely. The other party will be notified. You can include an optional note.'
    : "Optionally let the other party know why you're rejecting this request. You can leave it blank.";
  const confirmLabel = isRemove ? 'Remove & Cancel Request' : 'Reject Request';
  const placeholder = isRemove ? 'Reason for cancellation (optional)…' : 'Reason for rejection (optional)…';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="rejection-reason">Reason (optional)</Label>
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
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RejectRequestDialog;
