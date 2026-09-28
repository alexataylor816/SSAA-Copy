import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Mail, Bell } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationType: 'project' | 'dm' | 'group';
  hasAttachments: boolean;
  onConfirm: (choice: { email: boolean; sms: boolean }) => void;
}

export default function SendChannelPromptDialog({
  open,
  onOpenChange,
  conversationType,
  hasAttachments,
  onConfirm,
}: Props) {
  const [email, setEmail] = useState(false);
  const [sms, setSms] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail(false);
      setSms(false);
    }
  }, [open]);

  const isBroadcast = conversationType !== 'dm';
  const title = isBroadcast ? 'Also send to all parties?' : 'Also send to this person?';
  const description = isBroadcast
    ? 'Do you want this message to also be sent as an email or push notification to all parties in this conversation?'
    : 'Do you want this message to also be sent as an email or push notification?';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <label className="flex items-center gap-3 p-3 rounded-md border cursor-pointer hover:bg-muted/50">
            <Checkbox checked={email} onCheckedChange={(v) => setEmail(v === true)} />
            <Mail className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Send as Email</span>
          </label>
          <label className="flex items-center gap-3 p-3 rounded-md border cursor-pointer hover:bg-muted/50">
            <Checkbox checked={sms} onCheckedChange={(v) => setSms(v === true)} />
            <Bell className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Send push notification and message</span>
          </label>
          {hasAttachments && (email || sms) && (
            <p className="text-xs text-muted-foreground">
              Note: attachments are only delivered in-app. Email and push notifications include the message text only.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => { onOpenChange(false); onConfirm({ email, sms }); }}>
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
