import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Undo2, Send } from 'lucide-react';
import EditReasonDialog from './EditReasonDialog';

export interface DraftChange {
  employeeId: string;
  fromProjectId: string | null;
  fromDate: string | null;
  toProjectId: string | null;
  toDate: string | null;
  mode: 'move' | 'remove';
  originalRequestId?: string;
  /** Optional per-stop tracking. When present, this draft refers to a single
   *  availability stop for the employee rather than the employee as a whole. */
  stopId?: string;
}

interface MatrixDraftBarProps {
  changes: DraftChange[];
  onRevert: () => void;
  onPublish: (notify: { email: boolean; sms: boolean; notifyPersonnelEmail?: boolean; notifyPersonnelSms?: boolean; editReason?: string }) => void;
  isPublishing: boolean;
  /** 'sub' = subcontractor publishes own schedule (current behavior).
   *  'gc'  = GC sends request(s) to subs — no email/sms dialog. */
  mode?: 'sub' | 'gc';
}

const MatrixDraftBar = ({ changes, onRevert, onPublish, isPublishing, mode = 'sub' }: MatrixDraftBarProps) => {
  const [showNotifyDialog, setShowNotifyDialog] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifySms, setNotifySms] = useState(true);
  const [notifyPersonnelEmail, setNotifyPersonnelEmail] = useState(false);
  const [notifyPersonnelSms, setNotifyPersonnelSms] = useState(false);
  const [showEditReason, setShowEditReason] = useState(false);
  const [editReason, setEditReason] = useState<string | undefined>(undefined);

  if (changes.length === 0) return null;

  const hasMovedOrUnrequested = changes.some(c => c.fromProjectId !== null || !c.originalRequestId);

  // GC mode: button label depends on whether ANY draft is a brand-new assignment.
  // - All drafts have originalRequestId (pure edits to confirmed) → "Send Edit Request"
  // - Any draft has no originalRequestId (brand-new) → "Send Request"
  const isGcMode = mode === 'gc';
  const allEditsOnly = isGcMode && changes.every(c => !!c.originalRequestId);
  const publishLabel = isPublishing
    ? (isGcMode ? 'Sending...' : 'Publishing...')
    : isGcMode
      ? (allEditsOnly ? 'Send Edit Request' : 'Send Request')
      : 'Publish & Edit Schedule';

  // Any draft that touches an existing request is an edit — ask for context first.
  const hasEdits = changes.some(c => !!c.originalRequestId);

  const proceedPublish = (reason?: string) => {
    if (isGcMode) {
      onPublish({ email: false, sms: false, editReason: reason });
      return;
    }
    if (hasMovedOrUnrequested) {
      setShowNotifyDialog(true);
    } else {
      onPublish({ email: false, sms: false, notifyPersonnelEmail: false, notifyPersonnelSms: false, editReason: reason });
    }
  };

  const handlePublishClick = () => {
    if (hasEdits) {
      setShowEditReason(true);
      return;
    }
    proceedPublish(undefined);
  };

  return (
    <>
      <div className="fixed z-50 bg-card border border-border shadow-2xl inset-x-2 bottom-3 rounded-lg px-3 py-2 flex flex-col gap-2 sm:inset-x-auto sm:bottom-6 sm:left-1/2 sm:-translate-x-1/2 sm:rounded-xl sm:px-6 sm:py-3 sm:flex-row sm:items-center sm:gap-4">
        <span className="text-[11px] leading-tight font-medium text-foreground text-center sm:text-sm sm:text-left">
          <span className="sm:hidden">
            <span className="font-bold text-primary">{changes.length}</span> unsaved change{changes.length !== 1 ? 's' : ''}
          </span>
          <span className="hidden sm:inline">
            You have <span className="font-bold text-primary">{changes.length}</span> unsaved schedule change{changes.length !== 1 ? 's' : ''}
          </span>
        </span>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={onRevert}
            disabled={isPublishing}
            className="flex-1 sm:flex-none h-8 px-2 text-[11px] sm:h-9 sm:px-3 sm:text-sm"
          >
            <Undo2 className="h-3.5 w-3.5 mr-1 sm:h-4 sm:w-4" />
            <span className="truncate">Revert<span className="hidden sm:inline"> Changes</span></span>
          </Button>
          <Button
            size="sm"
            onClick={handlePublishClick}
            disabled={isPublishing}
            className="flex-1 sm:flex-none h-8 px-2 text-[11px] sm:h-9 sm:px-3 sm:text-sm"
          >
            <Send className="h-3.5 w-3.5 mr-1 sm:h-4 sm:w-4" />
            <span className="truncate">{publishLabel}</span>
          </Button>
        </div>
      </div>

      <EditReasonDialog
        open={showEditReason}
        onOpenChange={setShowEditReason}
        onConfirm={(reason) => {
          setShowEditReason(false);
          setEditReason(reason);
          proceedPublish(reason);
        }}
      />

      <Dialog open={showNotifyDialog} onOpenChange={setShowNotifyDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Notify General Contractors?</DialogTitle>
            <DialogDescription>
              You have newly assigned or moved employees. Do you want to notify the General Contractor(s) of these changes?
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="notify-email"
                checked={notifyEmail}
                onCheckedChange={(checked) => setNotifyEmail(!!checked)}
              />
              <label htmlFor="notify-email" className="text-sm font-medium cursor-pointer">
                Email
              </label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="notify-sms"
                checked={notifySms}
                onCheckedChange={(checked) => setNotifySms(!!checked)}
              />
              <label htmlFor="notify-sms" className="text-sm font-medium cursor-pointer">
                Push notification and message
              </label>
            </div>
          </div>

          <div className="space-y-3 py-2 border-t border-border">
            <div>
              <p className="font-semibold text-base">Notify Personnel or Wait for GC Confirmation?</p>
              <p className="text-sm text-muted-foreground">Leave both unchecked to wait for GC confirmation.</p>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="notify-personnel-email"
                checked={notifyPersonnelEmail}
                onCheckedChange={(checked) => setNotifyPersonnelEmail(!!checked)}
              />
              <label htmlFor="notify-personnel-email" className="text-sm font-medium cursor-pointer">
                Email
              </label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="notify-personnel-sms"
                checked={notifyPersonnelSms}
                onCheckedChange={(checked) => setNotifyPersonnelSms(!!checked)}
              />
              <label htmlFor="notify-personnel-sms" className="text-sm font-medium cursor-pointer">
                Push notification and message
              </label>
            </div>
          </div>

          <DialogFooter className="flex flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => setShowNotifyDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                setShowNotifyDialog(false);
                onPublish({ email: notifyEmail, sms: notifySms, notifyPersonnelEmail, notifyPersonnelSms, editReason });
              }}
            >
              Edit Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default MatrixDraftBar;
