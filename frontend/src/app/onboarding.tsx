import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { View } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';

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
import {
  useCreateCompanyMutation,
  useGetMeQuery,
  useListCompaniesQuery,
  useRequestJoinCompanyMutation,
  type Company,
  type CompanyType,
} from '@/store/api/rbac';
import { signOut } from '@/store/authStorage';
import type { AppDispatch, RootState } from '@/store/store';

type Step = 'type' | 'action' | 'create' | 'join' | 'pending';

export default function OnboardingScreen() {
  const theme = useTheme();
  const dispatch = useDispatch<AppDispatch>();
  const { user, hydrated } = useSelector((state: RootState) => state.auth);

  useEffect(() => {
    if (hydrated && !user) {
      router.replace('/');
    }
  }, [hydrated, user]);

  const { data: me } = useGetMeQuery(undefined, { skip: !user });

  useEffect(() => {
    if (me?.company) {
      router.replace('/dashboard');
    }
  }, [me]);

  const [step, setStep] = useState<Step>('type');
  const [companyType, setCompanyType] = useState<CompanyType | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [createCompany, createState] = useCreateCompanyMutation();
  const [requestJoin, joinState] = useRequestJoinCompanyMutation();

  const { data: companies } = useListCompaniesQuery(
    { type: companyType! },
    { skip: step !== 'join' || !companyType },
  );

  const chooseType = (type: CompanyType) => {
    setCompanyType(type);
    setStep('action');
  };

  const handleCreate = async () => {
    setError(null);
    if (!name.trim() || !companyType) {
      setError('Company name is required.');
      return;
    }
    try {
      await createCompany({ name: name.trim(), companyType, address: address.trim() || undefined }).unwrap();
      router.replace('/dashboard');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const handleJoin = async (company: Company) => {
    setError(null);
    try {
      await requestJoin({ companyId: company.id }).unwrap();
      setStep('pending');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <CenteredScreen>
      <Card style={{ gap: Spacing.four }}>
        {step === 'type' && (
          <>
            <View style={{ alignItems: 'center', gap: Spacing.half }}>
              <ThemedText type="subtitle" themeColor="brandForeground">
                Set up your company
              </ThemedText>
              <ThemedText type="small" themeColor="mutedForeground" style={{ textAlign: 'center' }}>
                Are you a general contractor or a subcontractor?
              </ThemedText>
            </View>
            <Button label="General Contractor" onPress={() => chooseType('gc')} />
            <Button label="Subcontractor" onPress={() => chooseType('sub')} />
          </>
        )}

        {step === 'action' && companyType && (
          <>
            <View style={{ alignItems: 'center', gap: Spacing.half }}>
              <ThemedText type="subtitle" themeColor="brandForeground">
                {companyType === 'gc' ? 'General Contractor' : 'Subcontractor'}
              </ThemedText>
              <ThemedText type="small" themeColor="mutedForeground">
                New company, or joining one that’s already on SSAA?
              </ThemedText>
            </View>
            <Button label="Create a new company" onPress={() => setStep('create')} />
            <Button label="Join an existing company" variant="outline" onPress={() => setStep('join')} />
            <TextLink label="Back" onPress={() => setStep('type')} />
          </>
        )}

        {step === 'create' && (
          <>
            <ThemedText type="subtitle" themeColor="brandForeground">
              Company details
            </ThemedText>
            <TextField label="Company name" value={name} onChangeText={setName} placeholder="Acme Builders" />
            <TextField label="Address (optional)" value={address} onChangeText={setAddress} />
            {error && (
              <ThemedText type="small" themeColor="destructive">
                {error}
              </ThemedText>
            )}
            <Button
              label={createState.isLoading ? 'Creating…' : 'Create company'}
              loading={createState.isLoading}
              onPress={handleCreate}
            />
            <TextLink label="Back" onPress={() => setStep('action')} />
          </>
        )}

        {step === 'join' && (
          <>
            <ThemedText type="subtitle" themeColor="brandForeground">
              Find your company
            </ThemedText>
            {error && (
              <ThemedText type="small" themeColor="destructive">
                {error}
              </ThemedText>
            )}
            <View style={{ gap: Spacing.two }}>
              {companies?.companies.length === 0 && (
                <ThemedText type="small" themeColor="mutedForeground">
                  No {companyType === 'gc' ? 'general contractor' : 'subcontractor'} companies yet.
                </ThemedText>
              )}
              {companies?.companies.map((company) => (
                <ThemedView
                  key={company.id}
                  type="background"
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: Spacing.two,
                    padding: Spacing.three,
                  }}>
                  <ThemedText type="small" themeColor="brandForeground">
                    {company.name}
                  </ThemedText>
                  <Button
                    label="Request to join"
                    variant="outline"
                    disabled={joinState.isLoading}
                    onPress={() => handleJoin(company)}
                  />
                </ThemedView>
              ))}
            </View>
            <TextLink label="Back" onPress={() => setStep('action')} />
          </>
        )}

        {step === 'pending' && (
          <>
            <ThemedText type="subtitle" themeColor="brandForeground">
              Request sent
            </ThemedText>
            <ThemedText type="small" themeColor="mutedForeground">
              Your company’s account holder needs to approve your request before you can sign in. Check back
              later, or sign out for now.
            </ThemedText>
            <Button label="Sign out" variant="outline" onPress={() => signOut(dispatch)} />
          </>
        )}
      </Card>
    </CenteredScreen>
  );
}
