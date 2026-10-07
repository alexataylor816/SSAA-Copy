import { useEffect, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { ArrowLeft, RefreshCw, Trash2 } from 'lucide-react-native';

import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PermissionPicker } from '@/components/ui/permission-picker';
import { TextField } from '@/components/ui/text-field';
import { useToast } from '@/components/ui/toast';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/api-error';
import {
  useAssignPermissionMutation,
  useCreateEmployeeMutation,
  useGetMeQuery,
  useListCompanyMembersQuery,
  useListEmployeesQuery,
  useRemoveEmployeeMutation,
  type PermissionLevel,
} from '@/store/api/rbac';

const PERMISSION_LEVELS: PermissionLevel[] = [
  'basic',
  'level_1',
  'partial',
  'full',
  'account_holder',
];

export default function CompanySettingsScreen() {
  const theme = useTheme();
  const { toast } = useToast();
  const [refreshing, setRefreshing] = useState(false);

  const { data: me } = useGetMeQuery();
  const companyId = me?.company?.id;

  // Company settings is a write target, so re-read whenever the screen regains
  // focus rather than relying on tag invalidation alone — a join request can be
  // approved from another screen while this one is still mounted.
  const { data: membersData, isLoading: membersLoading, refetch: refetchMembers } =
    useListCompanyMembersQuery(
      { companyId: companyId as string },
      { skip: !companyId, refetchOnMountOrArgChange: true },
    );
  const { data: employeesData, isLoading: employeesLoading, refetch: refetchEmployees } =
    useListEmployeesQuery(
      { companyId: companyId as string },
      { skip: !companyId, refetchOnMountOrArgChange: true },
    );

  const [assignPermission, { isLoading: assigning }] = useAssignPermissionMutation();
  const [createEmployee, { isLoading: creating }] = useCreateEmployeeMutation();
  const [removeEmployee, { isLoading: removing }] = useRemoveEmployeeMutation();

  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');

  const members = membersData?.members ?? [];
  const employees = employeesData?.employees ?? [];
  const isAccountHolder = me?.isAccountHolder ?? false;

  // Company settings is a write target, so re-read on focus rather than relying
  // on cache invalidation alone — a member can be approved from another tab.
  useFocusEffect(
    useEffect(() => {
      if (!companyId) return;
      void refetchMembers();
      void refetchEmployees();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [companyId]),
  );

  async function refresh() {
    setRefreshing(true);
    try {
      await Promise.all([refetchMembers(), refetchEmployees()]);
    } finally {
      setRefreshing(false);
    }
  }

  async function onAssign(userId: string, permissionLevel: PermissionLevel) {
    if (!companyId) return;
    try {
      await assignPermission({ companyId, userId, permissionLevel }).unwrap();
      toast({ title: 'Permissions updated' });
    } catch (err) {
      toast({
        title: 'Could not update permissions',
        description: errorMessage(err),
        variant: 'destructive',
      });
    }
  }

  async function onAddEmployee() {
    if (!companyId) return;
    const name = newName.trim();
    if (!name) return;
    try {
      await createEmployee({ companyId, name, email: newEmail.trim() || null }).unwrap();
      setNewName('');
      setNewEmail('');
      toast({ title: 'Employee added' });
    } catch (err) {
      toast({
        title: 'Could not add that employee',
        description: errorMessage(err),
        variant: 'destructive',
      });
    }
  }

  async function onRemoveEmployee(employeeId: string) {
    try {
      await removeEmployee({ employeeId }).unwrap();
      toast({ title: 'Employee removed' });
    } catch (err) {
      toast({
        title: 'Could not remove that employee',
        description: errorMessage(err),
        variant: 'destructive',
      });
    }
  }

  const busy = assigning || creating || removing;

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <Pressable onPress={() => router.back()} style={styles.back} accessibilityRole="button">
          <ArrowLeft color={theme.text} size={18} />
          <ThemedText style={styles.backLabel}>Dashboard</ThemedText>
        </Pressable>

        <ThemedText style={styles.headerTitle}>Company settings</ThemedText>

        <Pressable onPress={() => void refresh()} style={styles.refresh} accessibilityRole="button">
          <RefreshCw color={theme.text} size={18} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={theme.muted} />
        }
      >
        {!companyId ? (
          <Card>
            <ThemedText style={styles.empty}>You are not part of a company yet.</ThemedText>
          </Card>
        ) : (
          <>
            <Card>
              <ThemedText style={styles.cardTitle}>Company</ThemedText>
              <View style={styles.companyRow}>
                <ThemedText style={styles.companyName}>{me?.company?.name ?? 'Unknown'}</ThemedText>
                <Badge
                  label={me?.company?.companyType === 'gc' ? 'General contractor' : 'Subcontractor'}
                  variant="secondary"
                />
              </View>
            </Card>

            <Card>
              <ThemedText style={styles.cardTitle}>Members</ThemedText>

              {membersLoading ? (
                <ThemedText style={styles.empty}>Loading…</ThemedText>
              ) : members.length === 0 ? (
                <ThemedText style={styles.empty}>No members yet.</ThemedText>
              ) : (
                members.map((member, index) => (
                  <View
                    key={member.userId}
                    style={[styles.row, index > 0 && { borderTopColor: theme.border, borderTopWidth: 1 }]}
                  >
                    <View style={styles.rowText}>
                      <ThemedText style={styles.rowTitle}>{member.fullName || member.email}</ThemedText>
                      <ThemedText style={styles.rowSubtitle}>{member.email}</ThemedText>
                    </View>

                    {isAccountHolder && !member.isCompanyCreator ? (
                      <PermissionPicker
                        levels={PERMISSION_LEVELS}
                        value={member.permissionLevel}
                        onChange={(level) => void onAssign(member.userId, level)}
                      />
                    ) : (
                      <Badge
                        label={member.isCompanyCreator ? 'Creator' : member.permissionLevel.replace('_', ' ')}
                        variant="outline"
                      />
                    )}
                  </View>
                ))
              )}
            </Card>

            <Card>
              <ThemedText style={styles.cardTitle}>Employees</ThemedText>

              {employeesLoading ? (
                <ThemedText style={styles.empty}>Loading…</ThemedText>
              ) : employees.length === 0 ? (
                <ThemedText style={styles.empty}>No employees yet. Add the crews you schedule.</ThemedText>
              ) : (
                employees.map((employee, index) => (
                  <View
                    key={employee.id}
                    style={[styles.row, index > 0 && { borderTopColor: theme.border, borderTopWidth: 1 }]}
                  >
                    <View style={styles.rowText}>
                      <ThemedText style={styles.rowTitle}>{employee.name}</ThemedText>
                      <ThemedText style={styles.rowSubtitle}>
                        {employee.email ?? employee.phone ?? 'No contact details'}
                        {employee.linkedUserId ? ' · linked to an account' : ''}
                      </ThemedText>
                    </View>

                    {isAccountHolder ? (
                      <Pressable
                        disabled={busy}
                        onPress={() => void onRemoveEmployee(employee.id)}
                        style={[styles.remove, { borderColor: theme.border }]}
                        accessibilityRole="button"
                      >
                        <Trash2 color={theme.destructive} size={16} />
                      </Pressable>
                    ) : null}
                  </View>
                ))
              )}

              {isAccountHolder ? (
                <View style={[styles.addForm, { borderTopColor: theme.border }]}>
                  <TextField label="Name" value={newName} onChangeText={setNewName} placeholder="Crew member" />
                  <TextField
                    label="Email"
                    value={newEmail}
                    onChangeText={setNewEmail}
                    placeholder="Optional, links their account"
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                  <Button label="Add employee" onPress={() => void onAddEmployee()} disabled={busy || !newName.trim()} />
                </View>
              ) : null}
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  back: { alignItems: 'center', flexDirection: 'row', gap: Spacing.one },
  backLabel: { fontSize: 15, fontWeight: '500' },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '700' },
  refresh: { padding: Spacing.one },
  content: {
    alignSelf: 'center',
    gap: Spacing.three,
    maxWidth: 900,
    padding: Spacing.three,
    width: '100%',
  },
  cardTitle: { fontSize: 17, fontWeight: '700' },
  empty: { color: '#64748B', fontSize: 14 },
  companyRow: { alignItems: 'center', flexDirection: 'row', gap: Spacing.two },
  companyName: { fontSize: 15, fontWeight: '600' },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.three,
    justifyContent: 'space-between',
    paddingVertical: Spacing.three,
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowSubtitle: { color: '#64748B', fontSize: 13 },
  remove: {
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  addForm: {
    borderTopWidth: 1,
    gap: Spacing.two,
    marginTop: Spacing.two,
    paddingTop: Spacing.three,
  },
});