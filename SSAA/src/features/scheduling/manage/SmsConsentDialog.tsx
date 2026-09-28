import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

interface SmsConsentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phoneNumber: string;
  onAgree: () => void;
  onCancel: () => void;
}

const formatPhone = (digits: string) => {
  const d = digits.replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d.startsWith('1'))
    return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return digits;
};

const SmsConsentDialog = ({
  open,
  onOpenChange,
  phoneNumber,
  onAgree,
  onCancel,
}: SmsConsentDialogProps) => {
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    if (open) setAgreed(false);
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-center">
            SSAA Text Consent
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm text-foreground">
          <div className="space-y-1">
            <Label className="text-sm font-semibold">Mobile Phone Number</Label>
            <div className="rounded-md bg-muted px-3 py-2 text-foreground">
              {formatPhone(phoneNumber) || '—'}
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Checkbox
              id="sms-consent-checkbox"
              checked={agreed}
              onCheckedChange={(c) => setAgreed(c === true)}
              className="mt-0.5"
            />
            <Label
              htmlFor="sms-consent-checkbox"
              className="text-sm font-normal leading-relaxed cursor-pointer"
            >
              Yes, I would like to receive automated text messages from SSAA
              (Schedule Someone, Anytime, Anywhere) about schedule requests,
              confirmations, cancellations, reminders, and important account
              updates.
            </Label>
          </div>

          <p className="leading-relaxed">
            <span className="font-semibold">Message Frequency:</span> Message
            frequency may vary.
          </p>

          <p className="leading-relaxed">
            <span className="font-semibold">Standard Rates:</span> Message and
            data rates may apply.
          </p>

          <p className="leading-relaxed">
            <span className="font-semibold">Help &amp; Stop:</span> Reply HELP
            for help or STOP to cancel at any time. By providing your phone
            number and checking the box above, you agree to receive text
            messages from SSAA. Consent is not required to use the app.
          </p>


          <p className="text-sm">
            <a
              href="/terms"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              Terms of Service
            </a>
            <span className="text-muted-foreground"> | </span>
            <a
              href="/privacy"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              Privacy Policy
            </a>
          </p>
        </div>

        <div className="flex flex-col-reverse sm:flex-row gap-2 pt-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => {
              onCancel();
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            className="flex-1"
            disabled={!agreed}
            onClick={() => {
              onAgree();
              onOpenChange(false);
            }}
          >
            Yes, I would like to receive automated text messages
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SmsConsentDialog;
