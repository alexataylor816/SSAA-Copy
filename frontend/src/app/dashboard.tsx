import { useEffect, useMemo, useState } from 'react';
import { router } from 'expo-router';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ScheduleRequestsCard } from '@/components/dashboard/schedule-requests-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CalendarGrid } from '@/components/ui/calendar-grid';
import { Card } from '@/components/ui/card';
import { DayAvailabilityModal } from '@/components/ui/day-availability-modal';
import { PermissionPicker } from '@/components/ui/permission-picker';
import { TextField } from '@/components/ui/text-field';
import { TextLink } from '@/components/ui/text-link';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/api-error';
import { getMonthGrid, toDateKey } from '@/lib/calendar';
import {
  useApproveJoinRequestMutation,
  useAssignPermissionMutation,
  useGetMeQuery,
  useListCompanyMembersQuery,
  useListEmployeesQuery,
  useListJoinRequestsQuery,
  useRejectJoinRequestMutation,
  type Employee,
  type PermissionLevel,
} from '@/store/api/rbac';
import {
  useConnectProjectMutation,
  useCreateProjectMutation,
  useListAvailabilityQuery,
  useListProjectsQuery,
} from '@/store/api/scheduling';
import { signOut } from '@/store/authStorage';
import type { AppDispatch, RootState } from '@/store/store';

const LEVEL_LABELS: Record<PermissionLevel, string> = {
  basic: 'Basic',
  level_1: 'Level 1 (Foreman)',
  partial: 'Admin (Partial)',
  full: 'Admin (Full)',
  account_holder: 'Account Holder',
};

export default function DashboardScreen() {
  const theme = useTheme();
  const dispatch = useDispatch<AppDispatch>();
  const { user, hydrated } = useSelector((state: RootState) => state.auth);

  useEffect(() => {
    if (hydrated && !user) {
      router.replace('/');
    }
  }, [hydrated, user]);

  const { data: me, isLoading: meLoading } = useGetMeQuery(undefined, { skip: !user });

  useEffect(() => {
    if (me && !me.company) {
      router.replace('/onboarding');
    }
  }, [me]);

  const companyId = me?.company?.id;
  // Server-resolved so the UI can't drift from what the API actually enforces.
  const caps = me?.capabilities;
  const canManage = !!caps?.canManageTeam;
  const canApprove = !!caps?.canApproveJoinRequests;

  const { data: joinRequests } = useListJoinRequestsQuery(
    { companyId: companyId ?? '' },
    { skip: !companyId || !canApprove },
  );
  const { data: members } = useListCompanyMembersQuery({ companyId: companyId ?? '' }, { skip: !companyId });
  const { data: employeesData } = useListEmployeesQuery({ companyId: companyId ?? '' }, { skip: !companyId });
  const { data: projectsData } = useListProjectsQuery(undefined, { skip: !companyId });

  const [approve] = useApproveJoinRequestMutation();
  const [reject] = useRejectJoinRequestMutation();
  const [assignPermission] = useAssignPermissionMutation();
  const [createProject, createProjectState] = useCreateProjectMutation();
  const [connectProject, connectProjectState] = useConnectProjectMutation();

  const [approvalLevels, setApprovalLevels] = useState<Record<string, PermissionLevel>>({});
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectAddress, setNewProjectAddress] = useState('');
  const [showConnect, setShowConnect] = useState(false);
  const [connectCode, setConnectCode] = useState('');
  const [projectError, setProjectError] = useState<string | null>(null);

  const [monthDate, setMonthDate] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const grid = useMemo(() => getMonthGrid(monthDate), [monthDate]);
  const rangeStart = toDateKey(grid[0]);
  const rangeEnd = toDateKey(grid[grid.length - 1]);
  const { data: availabilityData } = useListAvailabilityQuery(
    { start: rangeStart, end: rangeEnd },
    { skip: !companyId },
  );

  const employeesById = useMemo(() => {
    const map: Record<string, Employee> = {};
    for (const employee of employeesData?.employees ?? []) {
      map[employee.id] = employee;
    }
    return map;
  }, [employeesData]);

  const currentUserEmployeeId =
    employeesData?.employees.find((e) => e.linkedUserId === user?.id)?.id ?? null;

  const countByDate = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const entry of availabilityData?.availability ?? []) {
      counts[entry.date] = (counts[entry.date] ?? 0) + 1;
    }
    return counts;
  }, [availabilityData]);

  if (!user || meLoading || !me?.company) {
    return (
      <ThemedView type="brandBackground" style={styles.loading}>
        <ThemedText type="small" themeColor="mutedForeground">
          Loading…
        </ThemedText>
      </ThemedView>
    );
  }

  const company = me.company;

  const handleApprove = async (requestId: string) => {
    const permissionLevel = approvalLevels[requestId] ?? me.visiblePermissions[me.visiblePermissions.length - 1];
    try {
      await approve({ companyId: company.id, requestId, permissionLevel }).unwrap();
    } catch (err) {
      Alert.alert('Could not approve', errorMessage(err));
    }
  };

  const handleReject = async (requestId: string) => {
    try {
      await reject({ companyId: company.id, requestId }).unwrap();
    } catch (err) {
      Alert.alert('Could not reject', errorMessage(err));
    }
  };

  const handleChangeMemberLevel = async (userId: string, permissionLevel: PermissionLevel) => {
    try {
      await assignPermission({ companyId: company.id, userId, permissionLevel }).unwrap();
    } catch (err) {
      Alert.alert("Couldn't change permission", errorMessage(err));
    }
  };

  const handleCreateProject = async () => {
    setProjectError(null);
    if (!newProjectName.trim()) {
      setProjectError('Project name is required.');
      return;
    }
    try {
      await createProject({ name: newProjectName.trim(), address: newProjectAddress.trim() || undefined }).unwrap();
      setNewProjectName('');
      setNewProjectAddress('');
      setShowNewProject(false);
    } catch (err) {
      setProjectError(errorMessage(err));
    }
  };

  const handleConnectProject = async () => {
    setProjectError(null);
    if (!connectCode.trim()) {
      setProjectError('Enter a connection code.');
      return;
    }
    try {
      await connectProject({ code: connectCode.trim() }).unwrap();
      setConnectCode('');
      setShowConnect(false);
    } catch (err) {
      setProjectError(errorMessage(err));
    }
  };

  return (
    <ScrollView style={{ backgroundColor: theme.brandBackground }} contentContainerStyle={styles.scrollContent}>
      <View style={styles.content}>
        <Card style={styles.headerCard}>
          <View style={styles.headerRow}>
            <View style={{ gap: Spacing.two }}>
              <ThemedText type="subtitle" themeColor="brandForeground">
                {company.name}
              </ThemedText>
              <View style={{ flexDirection: 'row', gap: Spacing.two }}>
                <Badge
                  variant="secondary"
                  label={company.companyType === 'gc' ? 'General Contractor' : 'Subcontractor'}
                />
                <Badge label={LEVEL_LABELS[me.permissionLevel ?? 'basic']} />
              </View>
            </View>
            <Button label="Sign out" variant="outline" onPress={() => signOut(dispatch)} />
          </View>
          <ThemedText type="small" themeColor="mutedForeground">
            Signed in as {user.fullName} ({user.email})
          </ThemedText>
        </Card>

        {canApprove && joinRequests && joinRequests.requests.length > 0 && (
          <Card>
            <ThemedText type="smallBold" themeColor="brandForeground">
              Pending join requests
            </ThemedText>
            {joinRequests.requests.map((req) => (
              <View key={req.id} style={[styles.requestRow, { borderColor: theme.border }]}>
                <ThemedText type="small" themeColor="brandForeground">
                  User {req.userId.slice(0, 8)}…
                </ThemedText>
                <PermissionPicker
                  levels={me.visiblePermissions}
                  value={approvalLevels[req.id] ?? me.visiblePermissions[me.visiblePermissions.length - 1]}
                  onChange={(level) => setApprovalLevels((prev) => ({ ...prev, [req.id]: level }))}
                />
                <View style={styles.requestActions}>
                  <Button label="Approve" onPress={() => handleApprove(req.id)} />
                  <Button label="Reject" variant="outline" onPress={() => handleReject(req.id)} />
                </View>
              </View>
            ))}
          </Card>
        )}

        <Card>
          <ThemedText type="smallBold" themeColor="brandForeground">
            Team ({members?.members.length ?? 0})
          </ThemedText>
          {members?.members.map((member) => (
            <View key={member.userId} style={[styles.memberRow, { borderColor: theme.border }]}>
              <View style={{ gap: Spacing.half, flex: 1 }}>
                <ThemedText type="small" themeColor="brandForeground">
                  {member.fullName}
                  {member.isCompanyCreator ? ' · creator' : ''}
                </ThemedText>
                <ThemedText type="small" themeColor="mutedForeground">
                  {member.email}
                </ThemedText>
              </View>
              {canManage && member.userId !== user.id ? (
                <PermissionPicker
                  levels={me.visiblePermissions}
                  value={member.permissionLevel}
                  onChange={(level) => handleChangeMemberLevel(member.userId, level)}
                />
              ) : (
                <Badge variant="outline" label={LEVEL_LABELS[member.permissionLevel]} />
              )}
            </View>
          ))}
        </Card>

        <Card>
          <View style={styles.headerRow}>
            <ThemedText type="smallBold" themeColor="brandForeground">
              Projects ({projectsData?.projects.length ?? 0})
            </ThemedText>
          </View>

          {projectsData?.projects.map((project) => (
            <View key={project.id} style={[styles.projectRow, { borderColor: theme.border }]}>
              <View style={{ flex: 1 }}>
                <ThemedText type="small" themeColor="brandForeground">
                  {project.name}
                </ThemedText>
                <ThemedText type="small" themeColor="mutedForeground">
                  {project.companyId === companyId ? 'Owned' : 'Connected'} · Code: {project.connectionCode}
                </ThemedText>
              </View>
            </View>
          ))}

          {projectError && (
            <ThemedText type="small" themeColor="destructive">
              {projectError}
            </ThemedText>
          )}

          {showNewProject && (
            <View style={[styles.projectForm, { borderColor: theme.border }]}>
              <TextField label="Project name" value={newProjectName} onChangeText={setNewProjectName} />
              <TextField
                label="Address (optional)"
                value={newProjectAddress}
                onChangeText={setNewProjectAddress}
              />
              <Button
                label={createProjectState.isLoading ? 'Creating…' : 'Create'}
                loading={createProjectState.isLoading}
                onPress={handleCreateProject}
              />
            </View>
          )}

          {showConnect && (
            <View style={[styles.projectForm, { borderColor: theme.border }]}>
              <TextField label="Connection code" value={connectCode} onChangeText={setConnectCode} autoCapitalize="none" />
              <Button
                label={connectProjectState.isLoading ? 'Connecting…' : 'Connect'}
                loading={connectProjectState.isLoading}
                onPress={handleConnectProject}
              />
            </View>
          )}

          <View style={styles.requestActions}>
            <TextLink
              label={showNewProject ? 'Cancel' : '+ New project'}
              onPress={() => {
                setProjectError(null);
                setShowNewProject((v) => !v);
                setShowConnect(false);
              }}
            />
            <TextLink
              label={showConnect ? 'Cancel' : 'Connect via code'}
              onPress={() => {
                setProjectError(null);
                setShowConnect((v) => !v);
                setShowNewProject(false);
              }}
            />
          </View>
        </Card>

        <ScheduleRequestsCard
          companyId={companyId!}
          projects={projectsData?.projects ?? []}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          canManage={canManage}
        />

        <Card>
          <ThemedText type="smallBold" themeColor="brandForeground">
            Calendar
          </ThemedText>
          <CalendarGrid
            monthDate={monthDate}
            onMonthChange={setMonthDate}
            countByDate={countByDate}
            onSelectDay={setSelectedDay}
          />
        </Card>
      </View>

      <DayAvailabilityModal
        date={selectedDay}
        onClose={() => setSelectedDay(null)}
        projects={projectsData?.projects ?? []}
        employeesById={employeesById}
        availability={availabilityData?.availability ?? []}
        currentUserEmployeeId={currentUserEmployeeId}
        canDeleteAny={!!caps?.canRemoveAnyAvailability}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    alignSelf: 'center',
    gap: Spacing.four,
    maxWidth: 720,
    padding: Spacing.four,
    width: '100%',
  },
  headerCard: {
    gap: Spacing.two,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  loading: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  memberRow: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: Spacing.three,
    paddingTop: Spacing.three,
  },
  projectForm: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.two,
    paddingTop: Spacing.three,
  },
  projectRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
  },
  requestActions: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  requestRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.two,
    paddingTop: Spacing.three,
  },
  scrollContent: {
    flexGrow: 1,
  },
});
