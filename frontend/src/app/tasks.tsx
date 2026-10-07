import { useEffect, useMemo, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSelector } from 'react-redux';

import { TaskCalendar } from '@/components/dashboard/task-calendar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TaskEditorModal } from '@/components/ui/task-editor-modal';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getMonthGrid, toDateKey } from '@/lib/calendar';
import { useGetMeQuery } from '@/store/api/rbac';
import { useListProjectsQuery, useListScheduleRequestsQuery } from '@/store/api/scheduling';
import { useListTasksQuery, type Task, type TaskStatus } from '@/store/api/tasks';
import type { RootState } from '@/store/store';

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  complete: 'Complete',
};

type Scope = 'project' | 'all';

export default function TasksScreen() {
  const theme = useTheme();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const { user, hydrated } = useSelector((state: RootState) => state.auth);

  useEffect(() => {
    if (hydrated && !user) {
      router.replace('/');
    }
  }, [hydrated, user]);

  const { data: me } = useGetMeQuery(undefined, { skip: !user });
  const { data: projectsData } = useListProjectsQuery(undefined, { skip: !user });
  const { data: tasksData, isLoading: tasksLoading, refetch } = useListTasksQuery(undefined, {
    skip: !user,
  });

  const [scope, setScope] = useState<Scope>(projectId ? 'project' : 'all');
  const [monthDate, setMonthDate] = useState(() => new Date());
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const allTasks = useMemo(() => tasksData?.data ?? [], [tasksData]);
  const projects = useMemo(() => projectsData?.projects ?? [], [projectsData]);

  const visibleTasks = useMemo(
    () => (scope === 'project' && projectId ? allTasks.filter((t) => t.project_id === projectId) : allTasks),
    [allTasks, projectId, scope],
  );

  const monthRange = useMemo(() => {
    const days = getMonthGrid(monthDate);
    return { start: toDateKey(days[0]), end: toDateKey(days[days.length - 1]) };
  }, [monthDate]);

  const { data: requestsData } = useListScheduleRequestsQuery(monthRange, { skip: !user });

  const monthRequests = useMemo(() => {
    const requests = requestsData?.requests ?? [];
    if (scope === 'project' && projectId) {
      return requests.filter((r) => r.projectId === projectId);
    }
    return requests;
  }, [requestsData, projectId, scope]);

  const activeProject = projects.find((p) => p.id === projectId) ?? null;
  // Mirrors the registry's hasLevel1OrHigher check on the tasks table.
  const canEdit = !!me?.permissionLevel && me.permissionLevel !== 'basic';

  const grouped = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of visibleTasks) {
      const list = map.get(task.project_id) ?? [];
      list.push(task);
      map.set(task.project_id, list);
    }
    return map;
  }, [visibleTasks]);

  const openTask = (task: Task) => {
    setSelectedTask(task);
    setEditorOpen(true);
  };

  const toggleDay = (key: string) => {
    setSelectedDates((current) =>
      current.includes(key) ? current.filter((d) => d !== key) : [...current, key].sort(),
    );
  };

  const startNewTask = () => {
    setSelectedTask(null);
    setEditorOpen(true);
  };

  if (!user) {
    return (
      <ThemedView type="brandBackground" style={styles.loading}>
        <ThemedText type="small" themeColor="mutedForeground">
          Loading…
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.brandBackground }}
      contentContainerStyle={styles.scrollContent}>
      <View style={styles.content}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} accessibilityRole="button">
            <ThemedText type="small" themeColor="primary">
              ‹ Dashboard
            </ThemedText>
          </Pressable>
          {canEdit && <Button label="New task" onPress={startNewTask} />}
        </View>

        <Card style={styles.headerCard}>
          <ThemedText type="subtitle" themeColor="brandForeground">
            {activeProject ? activeProject.name : 'All projects'}
          </ThemedText>
          <ThemedText type="small" themeColor="mutedForeground">
            {visibleTasks.length} task{visibleTasks.length === 1 ? '' : 's'} on the schedule
          </ThemedText>

          {projectId && (
            <View style={styles.tabs}>
              <ScopeTab
                label="This project"
                active={scope === 'project'}
                onPress={() => setScope('project')}
              />
              <ScopeTab label="All projects" active={scope === 'all'} onPress={() => setScope('all')} />
            </View>
          )}
        </Card>

        <Card>
          {tasksLoading ? (
            <ThemedText type="small" themeColor="mutedForeground">
              Loading tasks…
            </ThemedText>
          ) : (
            <TaskCalendar
              monthDate={monthDate}
              onMonthChange={setMonthDate}
              tasks={visibleTasks}
              requests={monthRequests}
              selectedDates={selectedDates}
              onToggleDay={toggleDay}
              onClearSelection={() => setSelectedDates([])}
              onConfirmSelection={startNewTask}
              onSelectTask={openTask}
            />
          )}
        </Card>

        <Card>
          <ThemedText type="smallBold" themeColor="brandForeground">
            Tasks
          </ThemedText>

          {visibleTasks.length === 0 && (
            <ThemedText type="small" themeColor="mutedForeground">
              No tasks yet. Pick a few days on the calendar or create one to start building the
              schedule.
            </ThemedText>
          )}

          {Array.from(grouped.entries()).map(([pid, list]) => {
            const project = projects.find((p) => p.id === pid);
            return (
              <View key={pid} style={[styles.group, { borderColor: theme.border }]}>
                <ThemedText type="smallBold" themeColor="mutedForeground">
                  {project?.name ?? 'Unknown project'}
                </ThemedText>
                {list.map((task) => (
                  <Pressable
                    key={task.id}
                    onPress={() => openTask(task)}
                    accessibilityRole="button"
                    style={[styles.taskRow, { borderColor: theme.border }]}>
                    <View style={[styles.colorBar, { backgroundColor: task.color ?? theme.primary }]} />
                    <View style={{ flex: 1, gap: Spacing.half }}>
                      <ThemedText type="small" themeColor="brandForeground">
                        {task.name}
                      </ThemedText>
                      <ThemedText type="small" themeColor="mutedForeground">
                        {task.start_date} → {task.end_date}
                      </ThemedText>
                    </View>
                    <Badge
                      variant={task.status === 'complete' ? 'secondary' : 'outline'}
                      label={STATUS_LABELS[task.status]}
                    />
                  </Pressable>
                ))}
              </View>
            );
          })}
        </Card>
      </View>

      <TaskEditorModal
        visible={editorOpen}
        task={selectedTask}
        projectId={projectId ?? visibleTasks[0]?.project_id ?? ''}
        initialStart={selectedDates[0]}
        initialEnd={selectedDates[selectedDates.length - 1]}
        onClose={() => setEditorOpen(false)}
        onSaved={refetch}
      />
    </ScrollView>
  );
}

function ScopeTab({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={[
        styles.tab,
        { borderColor: theme.border },
        active && { backgroundColor: theme.primary, borderColor: theme.primary },
      ]}>
      <ThemedText
        type="small"
        themeColor={active ? 'primaryForeground' : 'mutedForeground'}
        style={styles.tabLabel}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  colorBar: {
    borderRadius: 2,
    height: 28,
    width: 4,
  },
  content: {
    alignSelf: 'center',
    gap: Spacing.four,
    maxWidth: 1100,
    padding: Spacing.four,
    width: '100%',
  },
  group: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.two,
    paddingTop: Spacing.three,
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
  scrollContent: {
    flexGrow: 1,
  },
  tab: {
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  tabLabel: {
    fontWeight: '600',
  },
  tabs: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  taskRow: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: Spacing.three,
    paddingTop: Spacing.two,
  },
});