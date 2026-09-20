import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Eye, EyeOff, Mail, Phone, ArrowLeft, Lock, ShieldCheck } from 'lucide-react';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';

interface ChangePasswordModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userEmail: string;
  userPhone: string | null;
}

type Step = 'choose' | 'verify' | 'newPassword';

const ChangePasswordModal = ({ open, onOpenChange, userEmail, userPhone }: ChangePasswordModalProps) => {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>('choose');
  const [channel, setChannel] = useState<'email' | 'sms'>('email');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const resetState = () => {
    setStep('choose');
    setChannel('email');
    setOtpCode('');
    setNewPassword('');
    setConfirmPassword('');
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setIsLoading(false);
  };

  const handleClose = (open: boolean) => {
    if (!open) resetState();
    onOpenChange(open);
  };

  const sendCode = async (selectedChannel: 'email' | 'sms') => {
    setIsLoading(true);
    setChannel(selectedChannel);
    try {
      const { data, error } = await supabase.functions.invoke('request-password-reset', {
        body: { email: userEmail, channel: selectedChannel },
      });
      if (error) throw error;
      if (data && !data.success) throw new Error(data.error || 'Failed to send code');
      
      toast({
        title: 'Code Sent',
        description: selectedChannel === 'email'
          ? `A verification code has been sent to ${userEmail}`
          : 'A verification code has been sent to your phone',
      });
      setStep('verify');
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const verifyCode = async () => {
    if (otpCode.length !== 6) return;
    setStep('newPassword');
  };

  const submitNewPassword = async () => {
    if (newPassword.length < 6) {
      toast({ title: 'Error', description: 'Password must be at least 6 characters.', variant: 'destructive' });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: 'Error', description: 'Passwords do not match.', variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('verify-reset-code', {
        body: { email: userEmail, code: otpCode, new_password: newPassword },
      });
      if (error) throw error;
      if (data && !data.success) throw new Error(data.error || 'Failed to reset password');
      
      toast({ title: 'Password Updated', description: 'Your password has been changed successfully.' });
      handleClose(false);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const hasPhone = !!userPhone && userPhone.replace(/\D/g, '').length >= 10;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        {step === 'choose' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5" />
                Want to change your password?
              </DialogTitle>
              <DialogDescription>
                For your security, we'll send a verification code to confirm your identity before allowing a password change.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 pt-2">
              <Button
                className="w-full justify-start gap-3"
                variant="outline"
                onClick={() => sendCode('email')}
                disabled={isLoading}
              >
                <Mail className="h-4 w-4" />
                Send code via Email
              </Button>
              <Button
                className="w-full justify-start gap-3"
                variant="outline"
                onClick={() => sendCode('sms')}
                disabled={isLoading || !hasPhone}
              >
                <Phone className="h-4 w-4" />
                Send code via Text
                {!hasPhone && <span className="text-xs text-muted-foreground ml-auto">(No phone on file)</span>}
              </Button>
            </div>
          </>
        )}

        {step === 'verify' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Lock className="h-5 w-5" />
                Enter Verification Code
              </DialogTitle>
              <DialogDescription>
                Enter the 6-digit code sent to your {channel === 'email' ? 'email' : 'phone'}.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="flex justify-center">
                <InputOTP maxLength={6} value={otpCode} onChange={setOtpCode}>
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setStep('choose'); setOtpCode(''); }}>
                  <ArrowLeft className="h-4 w-4 mr-1" /> Back
                </Button>
                <Button
                  variant="link"
                  size="sm"
                  className="ml-auto"
                  onClick={() => sendCode(channel)}
                  disabled={isLoading}
                >
                  Resend code
                </Button>
              </div>
              <Button className="w-full" onClick={verifyCode} disabled={otpCode.length !== 6}>
                Continue
              </Button>
            </div>
          </>
        )}

        {step === 'newPassword' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Lock className="h-5 w-5" />
                Set New Password
              </DialogTitle>
              <DialogDescription>
                Enter your new password below.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-2">
                <Label>New Password</Label>
                <div className="relative">
                  <Input
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New password"
                    className="pr-10"
                  />
                  <button type="button" onClick={() => setShowNewPassword(!showNewPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Confirm Password</Label>
                <div className="relative">
                  <Input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    className="pr-10"
                  />
                  <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <Button
                className="w-full"
                onClick={submitNewPassword}
                disabled={!newPassword || !confirmPassword || newPassword !== confirmPassword || isLoading}
              >
                {isLoading ? 'Updating...' : 'Update Password'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ChangePasswordModal;
