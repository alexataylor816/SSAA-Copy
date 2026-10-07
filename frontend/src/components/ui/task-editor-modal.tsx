import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/api-error';
import { toDateKey } from '@/lib/calendar';
import {
  useCreateTaskMutation,
  useDeleteTaskMutation,
  useUpdateTaskMutation,
  TASK_COLORS,
  type Task,
  type TaskStatus,
} from '@/store/api/tasks';

const STATUSES: TaskStatus[] = ['pending', 'in_progress', 'complete'];
const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  complete: 'Complete',
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One modal for both create and edit. `task` null means "create", otherwise the
 * form is seeded from that row.
 *
 * The form lives in its own component so closing the modal unmounts it. That way
 * reopening always starts from clean state without an effect that resets fields
 * after render (which cascades an extra render pass).
 */
export function TaskEditorModal({
  visible,
  task,
  projectId,
  initialStart,
  initialEnd,
  onClose,
  onSaved,
}: {
  visible: boolean;
  /** null to create a new task. */
  task: Task | null;
  projectId: string;
  /** Seeds the date fields when creating from a calendar selection. */
  initialStart?: string;
  initialEnd?: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  if (!visible) return null;
  return (
    <TaskForm
      key={`${task?.id ?? 'new'}:${initialStart ?? ''}:${initialEnd ?? ''}`}
      task={task}
      projectId={projectId}
      initialStart={initialStart}
      initialEnd={initialEnd}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function TaskForm({
  task,
  projectId,
  initialStart,
  initialEnd,
  onClose,
  onSaved,
}: {
  task: Task | null;
  projectId: string;
  initialStart?: string;
  initialEnd?: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const theme = useTheme();
  const editing = task !== null;

  const today = toDateKey(new Date());
  const [name, setName] = useState(task?.name ?? '');
  const [startDate, setStartDate] = useState(task?.start_date ?? initialStart ?? today);
  const [endDate, setEndDate] = useState(task?.end_date ?? initialEnd ?? today);
  const [color, setColor] = useState<string>(task?.color ?? TASK_COLORS[0]);
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'pending');
  const [description, setDescription] = useState(task?.description ?? '');
  const [error, setError] = useState<string | null>(null);

  const [createTask, createState] = useCreateTaskMutation();
  const [updateTask, updateState] = useUpdateTaskMutation();
  const [deleteTask, deleteState] = useDeleteTaskMutation();

  const busy = createState.isLoading || updateState.isLoading || deleteState.isLoading;

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Task name is required.');
      return;
    }
    if (!DATE_RE.test(startDate)) {
      setError('Start date must be YYYY-MM-DD.');
      return;
    }
    if (!DATE_RE.test(endDate)) {
      setError('End date must be YYYY-MM-DD.');
      return;
    }
    if (endDate < startDate) {
      setError('End date can’t be before the start date.');
      return;
    }

    setError(null);
    try {
      if (editing) {
        await updateTask({
          id: task.id,
          name: name.trim(),
          start_date: startDate,
          end_date: endDate,
          color,
          status,
          description: description.trim() || null,
        }).unwrap();
      } else {
        await createTask({
          projectId,
          name: name.trim(),
          startDate,
          endDate,
          color,
          description: description.trim() || undefined,
        }).unwrap();
      }
      onSaved?.();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const handleDelete = () => {
    if (!task) return;
    Alert.alert('Delete task', `Delete “${task.name}”? This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteTask({ id: task.id }).unwrap();
            onSaved?.();
            onClose();
          } catch (err) {
            setError(errorMessage(err));
          }
        },
      },
    ]);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable onPress={(e) => e.stopPropagation()} style={styles.sheetWrapper}>
          <ThemedView type="card" style={[styles.sheet, { borderColor: theme.border }]}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <View style={styles.headerRow}>
                <ThemedText type="subtitle" themeColor="brandForeground">
                  {editing ? 'Edit task' : 'New task'}
                </ThemedText>
                <Pressable onPress={onClose}>
                  <ThemedText type="small" themeColor="primary">
                    Close
                  </ThemedText>
                </Pressable>
              </View>

              <View style={{ gap: Spacing.three }}>
                <TextField label="Task name" value={name} onChangeText={setName} placeholder="Framing" />

                <View style={styles.dateRow}>
                  <View style={{ flex: 1 }}>
                    <TextField
                      label="Start date"
                      value={startDate}
                      onChangeText={setStartDate}
                      placeholder="YYYY-MM-DD"
                      autoCapitalize="none"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TextField
                      label="End date"
                      value={endDate}
                      onChangeText={setEndDate}
                      placeholder="YYYY-MM-DD"
                      autoCapitalize="none"
                    />
                  </View>
                </View>

                <View style={{ gap: Spacing.two }}>
                  <ThemedText type="smallBold" themeColor="brandForeground">
                    Colour
                  </ThemedText>
                  <View style={styles.chipsRow}>
                    {TASK_COLORS.map((option) => (
                      <Pressable
                        key={option}
                        onPress={() => setColor(option)}
                        accessibilityRole="button"
                        accessibilityLabel={`Colour ${option}`}
                        accessibilityState={{ selected: color === option }}
                        style={[
                          styles.swatch,
                          { backgroundColor: option },
                          color === option && { borderColor: theme.brandForeground, borderWidth: 2 },
                        ]}
                      />
                    ))}
                  </View>
                </View>

                {editing && (
                  <View style={{ gap: Spacing.two }}>
                    <ThemedText type="smallBold" themeColor="brandForeground">
                      Status
                    </ThemedText>
                    <View style={styles.chipsRow}>
                      {STATUSES.map((option) => (
                        <Pressable
                          key={option}
                          onPress={() => setStatus(option)}
                          accessibilityRole="button"
                          accessibilityState={{ selected: status === option }}
                          style={[
                            styles.chip,
                            { borderColor: theme.border },
                            status === option && { backgroundColor: theme.primary, borderColor: theme.primary },
                          ]}>
                          <ThemedText
                            type="small"
                            style={{ color: status === option ? theme.primaryForeground : theme.mutedForeground }}>
                            {STATUS_LABELS[option]}
                          </ThemedText>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                )}

                <TextField
                  label="Description (optional)"
                  value={description}
                  onChangeText={setDescription}
                  placeholder="What's happening in this task?"
                  multiline
                  // The shared input is a fixed 40px single-line box; give the
                  // description room and top-align it.
                  style={{ height: 88, paddingTop: Spacing.two, textAlignVertical: 'top' }}
                />

                {error && (
                  <ThemedText type="small" themeColor="destructive">
                    {error}
                  </ThemedText>
                )}

                <View style={styles.actions}>
                  {editing && (
                    <Button label="Delete" variant="outline" loading={deleteState.isLoading} onPress={handleDelete} />
                  )}
                  <Button
                    label={busy ? 'Saving…' : editing ? 'Save changes' : 'Create task'}
                    loading={busy}
                    onPress={handleSave}
                  />
                </View>

                {editing && (
                  <View style={[styles.metaRow, { borderColor: theme.border }]}>
                    <Badge variant="outline" label={STATUS_LABELS[task.status]} />
                    <ThemedText type="small" themeColor="mutedForeground">
                      {task.start_date} → {task.end_date}
                    </ThemedText>
                  </View>
                )}
              </View>
            </ScrollView>
          </ThemedView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.four,
  },
  chip: {
    borderRadius: Radius.full,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  dateRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.three,
  },
  metaRow: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: Spacing.two,
    paddingTop: Spacing.three,
  },
  sheet: {
    maxHeight: '100%',
  },
  sheetWrapper: {
    maxHeight: 560,
    maxWidth: 480,
    width: '100%',
  },
  swatch: {
    borderRadius: Radius.full,
    height: 32,
    width: 32,
  },
});