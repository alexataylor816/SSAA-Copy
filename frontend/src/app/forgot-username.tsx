import { useState } from 'react';
import { router } from 'expo-router';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CenteredScreen } from '@/components/ui/centered-screen';
import { TextField } from '@/components/ui/text-field';
import { TextLink } from '@/components/ui/text-link';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/api-error';
import { useRequestUsernameReminderMutation } from '@/store/api/auth';

export default function ForgotUsernameScreen() {
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [delivered, setDelivered] = useState(false);

  const [requestReminder, { isLoading }] = useRequestUsernameReminderMutation();

  const handleSubmit = async () => {
    setFormError(null);
    try {
      const result = await requestReminder({ email: email.trim().toLowerCase() }).unwrap();
      setDelivered(result.delivered);
      setSubmitted(true);
    } catch (err) {
      setFormError(errorMessage(err));
    }
  };

  return (
    <CenteredScreen>
      <Card>
        <View style={{ alignItems: 'center', gap: Spacing.half }}>
          <ThemedText type="subtitle" themeColor="brandForeground">
            Forgot your username?
          </ThemedText>
          <ThemedText type="small" themeColor="mutedForeground" style={{ textAlign: 'center' }}>
            Your username is the email address you signed up with. We can send it back to you as a reminder.
          </ThemedText>
        </View>

        {submitted ? (
          <View style={{ gap: Spacing.four }}>
            <ThemedView
              type="background"
              style={{
                borderRadius: Spacing.two,
                padding: Spacing.three,
                backgroundColor: delivered ? theme.primary + '1A' : theme.destructive + '1A',
              }}>
              <ThemedText type="small" style={{ color: delivered ? theme.primary : theme.destructive }}>
                {delivered
                  ? 'If an account exists with that email, we’ve sent you a reminder.'
                  : 'Email delivery isn’t configured on this server, so no reminder was sent. Your username is the email address you signed up with.'}
              </ThemedText>
            </ThemedView>
            <Button label="Back to sign in" variant="outline" onPress={() => router.back()} />
          </View>
        ) : (
          <View style={{ gap: Spacing.three }}>
            <TextField
              label="Email address"
              placeholder="you@company.com"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />

            {formError && (
              <ThemedText type="small" themeColor="destructive">
                {formError}
              </ThemedText>
            )}

            <Button label={isLoading ? 'Sending…' : 'Send reminder'} loading={isLoading} onPress={handleSubmit} />
            <TextLink label="Back to sign in" onPress={() => router.back()} />
          </View>
        )}
      </Card>
    </CenteredScreen>
  );
}