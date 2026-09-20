import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { KeyRound, Eye, EyeOff } from 'lucide-react';

interface ForcePasswordChangeModalProps {
  open: boolean;
  profileId: string;
  currentName: string | null;
  onComplete: () => void;
}

const ForcePasswordChangeModal = ({ open, profileId, currentName, onComplete }: ForcePasswordChangeModalProps) => {
  const { t } = useLanguage();
  const { refreshProfile } = useAuth();
  const [displayName, setDisplayName] = useState(currentName || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async () => {
    if (!newPassword || newPassword.length < 6) {
      toast({ title: t('common.error'), description: t('forcePassword.passwordMin6'), variant: 'destructive' });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: t('common.error'), description: t('forcePassword.passwordsNoMatch'), variant: 'destructive' });
      return;
    }
    if (!displayName.trim()) {
      toast({ title: t('common.error'), description: t('forcePassword.enterDisplayName'), variant: 'destructive' });
      return;
    }

    setIsLoading(true);
    try {
      const { error: authError } = await supabase.auth.updateUser({ password: newPassword });
      if (authError) throw authError;

      const { error: profileError } = await supabase
        .from('profiles')
        .update({ full_name: displayName.trim(), force_password_change: false })
        .eq('id', profileId);
      if (profileError) throw profileError;

      toast({ title: t('common.success'), description: t('forcePassword.nameAndPasswordUpdated') });
      // Refresh in-memory profile so force_password_change flips false and modal unmounts naturally
      await refreshProfile();
      onComplete();
    } catch (error: any) {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            {t('forcePassword.setupAccount')}
          </DialogTitle>
          <DialogDescription>
            {t('forcePassword.setNameAndPassword')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="displayName">{t('forcePassword.displayName')}</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t('forcePassword.yourName')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="newPassword">{t('forcePassword.newPassword')}</Label>
            <div className="relative">
              <Input
                id="newPassword"
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t('forcePassword.atLeast6')}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
              >
                {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">{t('forcePassword.confirmPassword')}</Label>
            <div className="relative">
              <Input
                id="confirmPassword"
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t('forcePassword.reEnter')}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <Button onClick={handleSubmit} disabled={isLoading} className="w-full">
            {isLoading ? t('common.saving') : t('forcePassword.saveAndContinue')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ForcePasswordChangeModal;
