import { useState, useEffect } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/contexts/LanguageContext';

interface EditReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the trimmed reason (or undefined when left blank). */
  onConfirm: (reason?: string) => void;
  /** 'single' = one request, 'all-dates' = applies to every selected day. */
  mode?: 'single' | 'all-dates';
}

const EditReasonDialog = ({ open, onOpenChange, onConfirm, mode = 'single' }: EditReasonDialogProps) => {
  const { t } = useLanguage();
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('editReason.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {mode === 'all-dates' ? t('editReason.descriptionAllDates') : t('editReason.description')}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2">
          <Label htmlFor="edit-reason">{t('editReason.label')}</Label>
          <Textarea
            id="edit-reason"
            rows={4}
            placeholder={t('editReason.placeholder')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        <AlertDialogFooter className="flex-col-reverse sm:flex-row gap-2">
          <AlertDialogCancel>{t('editReason.goBack')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              const trimmed = reason.trim();
              onConfirm(trimmed ? trimmed : undefined);
            }}
          >
            {t('editReason.save')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default EditReasonDialog;
