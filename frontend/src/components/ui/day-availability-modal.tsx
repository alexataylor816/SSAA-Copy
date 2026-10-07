import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/api-error';
import { isDateLocked, toDateKey } from '@/lib/calendar';
import type { Employee } from '@/store/api/rbac';
import type { Availability, Project } from '@/store/api/scheduling';
import { useDeleteAvailabilityMutation, useSetAvailabilityMutation } from '@/store/api/scheduling';

export function DayAvailabilityModal({
  date,
  onClose,
  projects,
  employeesById,
  availability,
  currentUserEmployeeId,
  canDeleteAny,
}: {
  date: Date | null;
  onClose: () => void;
  projects: Project[];
  employeesById: Record<string, Employee>;
  availability: Availability[];
  currentUserEmployeeId: string | null;
  canDeleteAny: boolean;
}) {
  const theme = useTheme();
  const [selectedProjectId, setSelectedProjectId] = useState<string | 'all' | null>(null);
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('16:00');
  const [error, setError] = useState<string | null>(null);

  const [setAvailability, setState] = useSetAvailabilityMutation();
  const [deleteAvailability] = useDeleteAvailabilityMutation();

  if (!date) return null;

  const dateKey = toDateKey(date);
  const locked = isDateLocked(date);
  const dayEntries = availability.filter((a) => a.date === dateKey);

  const handleAdd = async () => {
    setError(null);
    if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
      setError('Times must be formatted HH:MM (e.g. 08:00).');
      return;
    }
    if (selectedProjectId === null) {
      setError('Pick a project, or "All projects".');
      return;
    }
    try {
      await setAvailability({
        date: dateKey,
        startTime,
        endTime,
        allProjects: selectedProjectId === 'all',
        projectId: selectedProjectId === 'all' ? undefined : selectedProjectId,
      }).unwrap();
      setSelectedProjectId(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteAvailability({ id }).unwrap();
    } catch (err) {
      Alert.alert("Couldn't remove", errorMessage(err));
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable onPress={(e) => e.stopPropagation()} style={styles.sheetWrapper}>
          <ThemedView type="card" style={[styles.sheet, { borderColor: theme.border }]}>
            <ScrollView>
              <View style={styles.headerRow}>
                <ThemedText type="subtitle" themeColor="brandForeground">
                  {date.toDateString()}
                </ThemedText>
                <Pressable onPress={onClose}>
                  <ThemedText type="small" themeColor="primary">
                    Close
                  </ThemedText>
                </Pressable>
              </View>

              {locked && (
                <View style={[styles.lockedBanner, { backgroundColor: theme.muted + '33' }]}>
                  <ThemedText type="small" themeColor="mutedForeground">
                    Schedule locked — historical records can’t be modified.
                  </ThemedText>
                </View>
              )}

              <View style={{ gap: Spacing.two }}>
                <ThemedText type="smallBold" themeColor="brandForeground">
                  Who’s available
                </ThemedText>
                {dayEntries.length === 0 && (
                  <ThemedText type="small" themeColor="mutedForeground">
                    No one has set availability yet.
                  </ThemedText>
                )}
                {dayEntries.map((entry) => {
                  const employee = employeesById[entry.employeeId];
                  const project = entry.projectId ? projects.find((p) => p.id === entry.projectId) : null;
                  const canDelete = canDeleteAny || entry.employeeId === currentUserEmployeeId;
                  return (
                    <View key={entry.id} style={[styles.entryRow, { borderColor: theme.border }]}>
                      <View style={{ flex: 1 }}>
                        <ThemedText type="small" themeColor="brandForeground">
                          {employee?.name ?? 'Unknown'} · {entry.startTime}–{entry.endTime}
                        </ThemedText>
                        <ThemedText type="small" themeColor="mutedForeground">
                          {entry.allProjects ? 'All projects' : project?.name ?? 'Unknown project'}
                        </ThemedText>
                      </View>
                      {canDelete && (
                        <Pressable onPress={() => handleDelete(entry.id)}>
                          <ThemedText type="small" themeColor="destructive">
                            Remove
                          </ThemedText>
                        </Pressable>
                      )}
                    </View>
                  );
                })}
              </View>

              {!locked && (
                <View style={{ gap: Spacing.three, marginTop: Spacing.four }}>
                  <ThemedText type="smallBold" themeColor="brandForeground">
                    Add your availability
                  </ThemedText>

                  <View style={styles.chipsRow}>
                    <Pressable
                      onPress={() => setSelectedProjectId('all')}
                      style={[
                        styles.chip,
                        { borderColor: theme.border },
                        selectedProjectId === 'all' && { backgroundColor: theme.primary, borderColor: theme.primary },
                      ]}>
                      <ThemedText
                        type="small"
                        style={{ color: selectedProjectId === 'all' ? theme.primaryForeground : theme.mutedForeground }}>
                        All projects
                      </ThemedText>
                    </Pressable>
                    {projects.map((project) => (
                      <Pressable
                        key={project.id}
                        onPress={() => setSelectedProjectId(project.id)}
                        style={[
                          styles.chip,
                          { borderColor: theme.border },
                          selectedProjectId === project.id && {
                            backgroundColor: theme.primary,
                            borderColor: theme.primary,
                          },
                        ]}>
                        <ThemedText
                          type="small"
                          style={{
                            color: selectedProjectId === project.id ? theme.primaryForeground : theme.mutedForeground,
                          }}>
                          {project.name}
                        </ThemedText>
                      </Pressable>
                    ))}
                  </View>

                  <View style={styles.timeRow}>
                    <View style={{ flex: 1 }}>
                      <TextField label="Start" value={startTime} onChangeText={setStartTime} placeholder="08:00" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <TextField label="End" value={endTime} onChangeText={setEndTime} placeholder="16:00" />
                    </View>
                  </View>

                  {error && (
                    <ThemedText type="small" themeColor="destructive">
                      {error}
                    </ThemedText>
                  )}

                  <Button
                    label={setState.isLoading ? 'Saving…' : 'Add availability'}
                    loading={setState.isLoading}
                    onPress={handleAdd}
                  />
                </View>
              )}
            </ScrollView>
          </ThemedView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.four,
  },
  chip: {
    borderRadius: Spacing.two,
    borderWidth: 1,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  entryRow: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: Spacing.two,
    paddingTop: Spacing.two,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.three,
  },
  lockedBanner: {
    borderRadius: Spacing.two,
    marginBottom: Spacing.three,
    padding: Spacing.two,
  },
  sheet: {
    maxHeight: '100%',
  },
  sheetWrapper: {
    maxHeight: 560,
    width: '100%',
    maxWidth: 480,
  },
  timeRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
});
