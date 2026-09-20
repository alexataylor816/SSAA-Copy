import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp';

type Step = 'email' | 'otp' | 'new-password';

const ForgotPassword = () => {
  const { t } = useLanguage();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const { toast } = useToast();

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setIsLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('request-password-reset', {
        body: { email: email.trim() },
      });

      if (error) throw error;
      if (data && !data.success) throw new Error(data.error || 'Failed to send reset code');

      toast({
        title: t('forgotPassword.codeSent'),
        description: t('forgotPassword.codeSentDesc'),
      });
      setStep('otp');
    } catch (error: any) {
      toast({
        title: t('common.error'),
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyAndReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otpCode.length !== 6) {
      toast({ title: t('common.error'), description: t('forgotPassword.enterFull6Digit'), variant: 'destructive' });
      return;
    }
    if (step === 'otp') {
      setStep('new-password');
      return;
    }
    if (newPassword.length < 6) {
      toast({ title: t('common.error'), description: t('forgotPassword.passwordMin6'), variant: 'destructive' });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: t('common.error'), description: t('forgotPassword.passwordsNoMatch'), variant: 'destructive' });
      return;
    }
    setIsLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('verify-reset-code', {
        body: {
          email: email.trim(),
          code: otpCode,
          new_password: newPassword,
        },
      });

      if (error) throw error;
      if (data && !data.success) throw new Error(data.error || 'Failed to reset password');

      toast({ title: t('forgotPassword.passwordUpdated'), description: t('forgotPassword.passwordUpdatedDesc') });
      setTimeout(() => {
        window.location.href = '/';
      }, 1500);
    } catch (error: any) {
      toast({
        title: t('common.error'),
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-primary/20 shadow-lg">
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-2xl font-bold text-foreground">
            {step === 'email' && t('forgotPassword.resetPassword')}
            {step === 'otp' && t('forgotPassword.enterVerificationCode')}
            {step === 'new-password' && t('forgotPassword.setNewPassword')}
          </CardTitle>
          <p className="text-muted-foreground text-sm mt-1">
            {step === 'email' && t('forgotPassword.enterEmail')}
            {step === 'otp' && t('forgotPassword.codeSentTo', { email })}
            {step === 'new-password' && t('forgotPassword.chooseNewPassword')}
          </p>
        </CardHeader>
        <CardContent>
          {step === 'email' && (
            <form onSubmit={handleSendCode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">{t('forgotPassword.emailAddress')}</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                  className="border-input"
                />
              </div>
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? t('common.sending') : t('forgotPassword.sendVerificationCode')}
              </Button>
              <Link to="/" className="block">
                <Button variant="ghost" className="w-full">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {t('common.backToLogin')}
                </Button>
              </Link>
            </form>
          )}

          {step === 'otp' && (
            <form onSubmit={handleVerifyAndReset} className="space-y-4">
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
              <Button type="submit" className="w-full" disabled={isLoading || otpCode.length !== 6}>
                {t('onboarding.continue')}
              </Button>
              <Button type="button" variant="ghost" className="w-full" onClick={() => { setStep('email'); setOtpCode(''); }}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t('common.back')}
              </Button>
            </form>
          )}

          {step === 'new-password' && (
            <form onSubmit={handleVerifyAndReset} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="newPassword">{t('forgotPassword.newPassword')}</Label>
                <div className="relative">
                  <Input
                    id="newPassword"
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder={t('forgotPassword.atLeast6')}
                    required
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
                <Label htmlFor="confirmPassword">{t('forgotPassword.confirmPassword')}</Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder={t('forgotPassword.reEnterPassword')}
                    required
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
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? t('forgotPassword.updating') : t('forgotPassword.updatePassword')}
              </Button>
              <Button type="button" variant="ghost" className="w-full" onClick={() => setStep('otp')}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t('common.back')}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ForgotPassword;
