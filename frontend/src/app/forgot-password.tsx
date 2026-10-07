import { useState } from 'react';
import { router } from 'expo-router';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CenteredScreen } from '@/components/ui/centered-screen';
import { OtpInput } from '@/components/ui/otp-input';
import { TextField } from '@/components/ui/text-field';
import { TextLink } from '@/components/ui/text-link';
import { Spacing } from '@/constants/theme';
import { errorMessage } from '@/lib/api-error';
import { useRequestPasswordResetMutation, useVerifyResetCodeMutation } from '@/store/api/auth';

type Step = 'email' | 'otp' | 'new-password' | 'done';

export default function ForgotPasswordScreen() {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [requestReset, requestState] = useRequestPasswordResetMutation();
  const [verifyCode, verifyState] = useVerifyResetCodeMutation();

  const handleSendCode = async () => {
    setError(null);
    if (!email.trim()) return;
    try {
      const result = await requestReset({ email: email.trim().toLowerCase() }).unwrap();
      if (result.devCode) {
        // No email provider configured yet — surface the code directly so the
        // flow stays testable locally. Remove once email delivery lands.
        console.log(`[dev] password reset code: ${result.devCode}`);
      }
      setStep('otp');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const handleContinueFromOtp = () => {
    setError(null);
    if (otpCode.length !== 6) {
      setError('Enter the full 6-digit code.');
      return;
    }
    setStep('new-password');
  };

  const handleUpdatePassword = async () => {
    setError(null);
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    try {
      await verifyCode({ email: email.trim().toLowerCase(), code: otpCode, newPassword }).unwrap();
      setStep('done');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <CenteredScreen>
      <Card style={{ gap: Spacing.four }}>
        <View style={{ alignItems: 'center', gap: Spacing.half }}>
          <ThemedText type="subtitle" themeColor="brandForeground">
            {step === 'email' && 'Reset your password'}
            {step === 'otp' && 'Enter verification code'}
            {step === 'new-password' && 'Set a new password'}
            {step === 'done' && 'Password updated'}
          </ThemedText>
          <ThemedText type="small" themeColor="mutedForeground" style={{ textAlign: 'center' }}>
            {step === 'email' && 'Enter the email on your account.'}
            {step === 'otp' && `We sent a 6-digit code to ${email}`}
            {step === 'new-password' && 'Choose a new password for your account.'}
            {step === 'done' && 'You can now sign in with your new password.'}
          </ThemedText>
        </View>

        {step === 'email' && (
          <View style={{ gap: Spacing.three }}>
            <TextField
              label="Email address"
              placeholder="you@company.com"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            {error && (
              <ThemedText type="small" themeColor="destructive">
                {error}
              </ThemedText>
            )}
            <Button
              label={requestState.isLoading ? 'Sending…' : 'Send verification code'}
              loading={requestState.isLoading}
              onPress={handleSendCode}
            />
            <TextLink label="Back to sign in" onPress={() => router.back()} />
          </View>
        )}

        {step === 'otp' && (
          <View style={{ gap: Spacing.three }}>
            <OtpInput value={otpCode} onChange={setOtpCode} />
            {error && (
              <ThemedText type="small" themeColor="destructive" style={{ textAlign: 'center' }}>
                {error}
              </ThemedText>
            )}
            <Button label="Continue" onPress={handleContinueFromOtp} disabled={otpCode.length !== 6} />
            <TextLink
              label="Back"
              onPress={() => {
                setStep('email');
                setOtpCode('');
              }}
            />
          </View>
        )}

        {step === 'new-password' && (
          <View style={{ gap: Spacing.three }}>
            <TextField label="New password" value={newPassword} onChangeText={setNewPassword} secureToggle />
            <TextField
              label="Confirm password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureToggle
            />
            {error && (
              <ThemedText type="small" themeColor="destructive">
                {error}
              </ThemedText>
            )}
            <Button
              label={verifyState.isLoading ? 'Updating…' : 'Update password'}
              loading={verifyState.isLoading}
              onPress={handleUpdatePassword}
            />
            <TextLink label="Back" onPress={() => setStep('otp')} />
          </View>
        )}

        {step === 'done' && <Button label="Back to sign in" onPress={() => router.replace('/')} />}
      </Card>
    </CenteredScreen>
  );
}
