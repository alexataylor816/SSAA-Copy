import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { TextLink } from '@/components/ui/text-link';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/api-error';
import { setCredentials } from '@/store/authSlice';
import { persistAuth } from '@/store/authStorage';
import { useSignInMutation, useSignUpMutation } from '@/store/api/auth';
import type { AppDispatch, RootState } from '@/store/store';

const FEATURES = [
  { icon: '📅', label: 'Smart scheduling' },
  { icon: '👥', label: 'Team management' },
  { icon: '🏢', label: 'Project tracking' },
];

export default function LandingScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const isWide = width >= 900;
  const dispatch = useDispatch<AppDispatch>();
  const { user, hydrated } = useSelector((state: RootState) => state.auth);

  const [isSignUp, setIsSignUp] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const [signUp, signUpState] = useSignUpMutation();
  const [signIn, signInState] = useSignInMutation();
  const isLoading = signUpState.isLoading || signInState.isLoading;

  useEffect(() => {
    if (hydrated && user) {
      router.replace('/dashboard');
    }
  }, [hydrated, user]);

  const handleSubmit = async () => {
    setFormError(null);
    try {
      const result = isSignUp
        ? await signUp({ email: email.trim().toLowerCase(), password, fullName: fullName.trim() }).unwrap()
        : await signIn({ email: email.trim().toLowerCase(), password }).unwrap();

      dispatch(setCredentials(result));
      persistAuth(result);
      setPassword('');
      router.replace('/dashboard');
    } catch (err) {
      setFormError(errorMessage(err));
    }
  };

  return (
    <ScrollView
      style={{ backgroundColor: theme.brandBackground }}
      contentContainerStyle={styles.scrollContent}>
      <View style={[styles.container, isWide && styles.containerWide]}>
        {/* Hero panel */}
        <View style={[styles.hero, { backgroundColor: theme.primary }, isWide && styles.heroWide]}>
          <SafeAreaView style={styles.heroContent}>
            <ThemedText type="title" style={{ color: theme.primaryForeground }}>
              SSAA
            </ThemedText>
            <ThemedText type="subtitle" style={[styles.tagline, { color: theme.primaryForeground }]}>
              Scheduling that keeps your crew in sync
            </ThemedText>
            <ThemedText type="default" style={[styles.description, { color: theme.primaryForeground }]}>
              Build schedules, manage your team, and track every project from one place.
            </ThemedText>

            <View style={styles.features}>
              {FEATURES.map((feature) => (
                <View
                  key={feature.label}
                  style={[styles.featurePill, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
                  <ThemedText type="small" style={{ color: theme.primaryForeground }}>
                    {feature.icon} {feature.label}
                  </ThemedText>
                </View>
              ))}
            </View>
          </SafeAreaView>
        </View>

        {/* Login panel */}
        <View style={[styles.loginPanel, isWide && styles.loginPanelWide]}>
          <ThemedView type="card" style={[styles.card, { borderColor: theme.border }]}>
            <View style={styles.cardHeader}>
              <ThemedText type="subtitle" themeColor="brandForeground">
                {isSignUp ? 'Create your account' : 'Welcome back'}
              </ThemedText>
              <ThemedText type="small" themeColor="mutedForeground">
                {isSignUp
                  ? 'Set up your company in a couple of minutes.'
                  : 'Sign in to get back to your schedule.'}
              </ThemedText>
            </View>

            <View style={styles.form}>
              {isSignUp && (
                <TextField
                  label="Full name"
                  placeholder="John Smith"
                  value={fullName}
                  onChangeText={setFullName}
                  autoCapitalize="words"
                />
              )}

              <TextField
                label="Email"
                placeholder="you@company.com"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
              />

              <TextField
                label="Password"
                placeholder="••••••••"
                value={password}
                onChangeText={setPassword}
                secureToggle
              />

              {formError && (
                <ThemedText type="small" themeColor="destructive">
                  {formError}
                </ThemedText>
              )}

              <Button
                label={isLoading ? 'Please wait…' : isSignUp ? 'Create account' : 'Sign in'}
                loading={isLoading}
                onPress={handleSubmit}
              />
            </View>

            <View style={styles.footer}>
              <TextLink
                label={isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
                onPress={() => {
                  setFormError(null);
                  setIsSignUp((v) => !v);
                }}
              />

              {!isSignUp && (
                <View style={styles.footerLinks}>
                  <TextLink label="Forgot username?" onPress={() => router.push('/forgot-username')} />
                  <TextLink label="Forgot password?" onPress={() => router.push('/forgot-password')} />
                </View>
              )}
            </View>
          </ThemedView>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Spacing.three,
    borderWidth: 1,
    gap: Spacing.four,
    padding: Spacing.four,
    width: '100%',
  },
  cardHeader: {
    alignItems: 'center',
    gap: Spacing.half,
  },
  container: {
    flex: 1,
  },
  containerWide: {
    flexDirection: 'row',
    minHeight: '100%',
  },
  description: {
    marginBottom: Spacing.four,
    opacity: 0.85,
  },
  featurePill: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  features: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  footer: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  footerLinks: {
    flexDirection: 'row',
    gap: Spacing.four,
  },
  form: {
    gap: Spacing.three,
  },
  hero: {
    padding: Spacing.five,
    paddingTop: Spacing.six,
  },
  heroContent: {
    gap: Spacing.two,
    maxWidth: 480,
  },
  heroWide: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  loginPanel: {
    alignItems: 'center',
    alignSelf: 'center',
    gap: Spacing.four,
    maxWidth: 440,
    padding: Spacing.four,
    width: '100%',
  },
  loginPanelWide: {
    flex: 1,
    justifyContent: 'center',
  },
  scrollContent: {
    flexGrow: 1,
  },
  tagline: {
    marginBottom: Spacing.two,
  },
});
