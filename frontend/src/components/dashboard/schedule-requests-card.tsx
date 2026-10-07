import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TextField } from '@/components/ui/text-field';
import { TextLink } from '@/components/ui/text-link';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/api-error';
import { useListConnectedEmployeesQuery, useListEmployeesQuery } from '@/store/api/rbac';
import {
  useCreateScheduleRequestMutation,
  useListProjectConnectionsQuery,
  useListScheduleRequestsQuery,
  useUpdateScheduleRequestStatusMutation,
  type Project,
  type ScheduleRequestStatus,
} from '@/store/api/scheduling';

const STATUS_LABEL: Record<ScheduleRequestStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export function ScheduleRequestsCard({
  companyId,
  projects,
  rangeStart,
  rangeEnd,
  canManage,
}: {
  companyId: string;
  projects: Project[];
  rangeStart: string;
  rangeEnd: string;
  canManage: boolean;
}) {
  const theme = useTheme();
  const { data: requestsData } = useListScheduleRequestsQuery({ start: rangeStart, end: rangeEnd });
  const { data: myEmployees } = useListEmployeesQuery({ companyId });

  const [updateStatus] = useUpdateScheduleRequestStatusMutation();

  const [showForm, setShowForm] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [subCompanyId, setSubCompanyId] = useState<string | null>(null);
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('16:00');
  const [formError, setFormError] = useState<string | null>(null);

  const [createRequest, createState] = useCreateScheduleRequestMutation();

  const ownedProjects = projects.filter((p) => p.companyId === companyId);
  const { data: connections } = useListProjectConnectionsQuery({ projectId: projectId ?? '' }, { skip: !projectId });
  const { data: connectedEmployees } = useListConnectedEmployeesQuery(
    { companyId: subCompanyId ?? '' },
    { skip: !subCompanyId },
  );

  const projectById = Object.fromEntries(projects.map((p) => [p.id, p]));
  const employeeById = Object.fromEntries((connectedEmployees?.employees ?? myEmployees?.employees ?? []).map((e) => [e.id, e]));

  const resetForm = () => {
    setProjectId(null);
    setSubCompanyId(null);
    setEmployeeIds([]);
    setDate('');
    setFormError(null);
  };

  const handleRespond = async (id: string, status: ScheduleRequestStatus) => {
    try {
      await updateStatus({ id, status }).unwrap();
    } catch (err) {
      Alert.alert("Couldn't update request", errorMessage(err));
    }
  };

  const handleCreate = async () => {
    setFormError(null);
    if (!projectId || !subCompanyId) {
      setFormError('Pick a project and a company.');
      return;
    }
    if (employeeIds.length === 0) {
      setFormError('Pick at least one person.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setFormError('Date must be formatted YYYY-MM-DD.');
      return;
    }
    try {
      await createRequest({
        projectId,
        subCompanyId,
        employeeIds,
        date,
        startTime: startTime || undefined,
        endTime: endTime || undefined,
      }).unwrap();
      resetForm();
      setShowForm(false);
    } catch (err) {
      setFormError(errorMessage(err));
    }
  };

  const requests = requestsData?.requests ?? [];

  return (
    <Card>
      <ThemedText type="smallBold" themeColor="brandForeground">
        Schedule requests ({requests.length})
      </ThemedText>

      {requests.length === 0 && (
        <ThemedText type="small" themeColor="mutedForeground">
          No requests this month.
        </ThemedText>
      )}

      {requests.map((req) => {
        const isSubSide = req.subCompanyId === companyId;
        const isRequestingSide = req.requestingCompanyId === companyId;
        const project = projectById[req.projectId];
        return (
          <View key={req.id} style={[styles.row, { borderColor: theme.border }]}>
            <View style={{ flex: 1, gap: Spacing.half }}>
              <ThemedText type="small" themeColor="brandForeground">
                {project?.name ?? 'Project'} · {req.date}
                {req.startTime ? ` · ${req.startTime}–${req.endTime}` : ''}
              </ThemedText>
              <ThemedText type="small" themeColor="mutedForeground">
                {req.employeeIds.map((id) => employeeById[id]?.name ?? id.slice(0, 8)).join(', ')}
              </ThemedText>
              <Badge
                variant={req.status === 'pending' ? 'secondary' : 'outline'}
                label={STATUS_LABEL[req.status]}
              />
            </View>
            {req.status === 'pending' && isSubSide && (
              <View style={styles.actions}>
                <Button label="Confirm" onPress={() => handleRespond(req.id, 'confirmed')} />
                <Button label="Reject" variant="outline" onPress={() => handleRespond(req.id, 'rejected')} />
              </View>
            )}
            {(req.status === 'pending' || req.status === 'confirmed') &&
              (isRequestingSide || isSubSide) &&
              !(req.status === 'pending' && isSubSide) && (
                <Button label="Cancel" variant="outline" onPress={() => handleRespond(req.id, 'cancelled')} />
              )}
          </View>
        );
      })}

      {formError && (
        <ThemedText type="small" themeColor="destructive">
          {formError}
        </ThemedText>
      )}

      {showForm && (
        <View style={[styles.form, { borderColor: theme.border }]}>
          <ThemedText type="small" themeColor="mutedForeground">
            Project
          </ThemedText>
          <View style={styles.chipsRow}>
            {ownedProjects.map((project) => (
              <Chip
                key={project.id}
                label={project.name}
                selected={projectId === project.id}
                onPress={() => {
                  setProjectId(project.id);
                  setSubCompanyId(null);
                  setEmployeeIds([]);
                }}
              />
            ))}
          </View>

          {projectId && (
            <>
              <ThemedText type="small" themeColor="mutedForeground">
                Company
              </ThemedText>
              <View style={styles.chipsRow}>
                {connections?.companies.map((c) => (
                  <Chip
                    key={c.id}
                    label={c.name}
                    selected={subCompanyId === c.id}
                    onPress={() => {
                      setSubCompanyId(c.id);
                      setEmployeeIds([]);
                    }}
                  />
                ))}
                {connections?.companies.length === 0 && (
                  <ThemedText type="small" themeColor="mutedForeground">
                    No companies connected to this project yet.
                  </ThemedText>
                )}
              </View>
            </>
          )}

          {subCompanyId && (
            <>
              <ThemedText type="small" themeColor="mutedForeground">
                People
              </ThemedText>
              <View style={styles.chipsRow}>
                {connectedEmployees?.employees.map((employee) => {
                  const selected = employeeIds.includes(employee.id);
                  return (
                    <Chip
                      key={employee.id}
                      label={employee.name}
                      selected={selected}
                      onPress={() =>
                        setEmployeeIds((prev) =>
                          selected ? prev.filter((id) => id !== employee.id) : [...prev, employee.id],
                        )
                      }
                    />
                  );
                })}
              </View>
            </>
          )}

          <TextField label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} placeholder="2026-10-15" />
          <View style={styles.timeRow}>
            <View style={{ flex: 1 }}>
              <TextField label="Start" value={startTime} onChangeText={setStartTime} />
            </View>
            <View style={{ flex: 1 }}>
              <TextField label="End" value={endTime} onChangeText={setEndTime} />
            </View>
          </View>

          <Button
            label={createState.isLoading ? 'Sending…' : 'Send request'}
            loading={createState.isLoading}
            onPress={handleCreate}
          />
        </View>
      )}

      {ownedProjects.length > 0 && (
        <TextLink
          label={showForm ? 'Cancel' : '+ Request people'}
          onPress={() => {
            setShowForm((v) => !v);
            setFormError(null);
          }}
        />
      )}
      {!canManage && (
        <ThemedText type="small" themeColor="mutedForeground">
          Partial-level access or higher is needed to request or respond to schedule requests.
        </ThemedText>
      )}
    </Card>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <ThemedText
      type="small"
      onPress={onPress}
      style={[
        styles.chip,
        { borderColor: theme.border, color: selected ? theme.primaryForeground : theme.mutedForeground },
        selected && { backgroundColor: theme.primary, borderColor: theme.primary },
      ]}>
      {label}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  chip: {
    borderRadius: Spacing.two,
    borderWidth: 1,
    overflow: 'hidden',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  form: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.two,
    paddingTop: Spacing.three,
  },
  row: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: Spacing.two,
    paddingTop: Spacing.three,
  },
  timeRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
});
