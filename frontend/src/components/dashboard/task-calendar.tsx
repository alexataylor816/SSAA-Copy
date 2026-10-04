import { useMemo } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  useColorScheme,
  useWindowDimensions,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  addMonths,
  formatMonthLabel,
  getMonthGrid,
  isSameMonth,
  isToday,
  toDateKey,
} from '@/lib/calendar';
import type { ScheduleRequest } from '@/store/api/scheduling';
import type { Task } from '@/store/api/tasks';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_TASK_LANES = 5;
const LANE_HEIGHT = 16;
const LANE_GAP = 2;
const BAR_INSET = 2;

interface DayStatus {
  total: number;
  confirmed: number;
  pending: number;
  rejected: number;
}

function coversRange(task: Task, day: Date): boolean {
  const key = toDateKey(day);
  return key >= task.start_date && key <= task.end_date;
}

function buildDayStatus(requests: ScheduleRequest[]): Map<string, DayStatus> {
  const map = new Map<string, DayStatus>();
  for (const request of requests) {
    const current = map.get(request.date) ?? {
      total: 0,
      confirmed: 0,
      pending: 0,
      rejected: 0,
    };
    current.total += 1;
    if (request.status === 'confirmed') current.confirmed += 1;
    else if (request.status === 'pending') current.pending += 1;
    else current.rejected += 1;
    map.set(request.date, current);
  }
  return map;
}

/**
 * Greedy lane assignment scoped to each row of 7 days. A global map would hide
 * tasks past the lane limit even when they never overlap anything else, so each
 * week row packs independently.
 */
function buildWeekLanes(tasks: Task[], days: Date[]): Map<number, Map<string, number>> {
  const result = new Map<number, Map<string, number>>();
  const sorted = [...tasks].sort((a, b) =>
    a.start_date !== b.start_date
      ? a.start_date.localeCompare(b.start_date)
      : a.name.localeCompare(b.name),
  );

  for (let weekStart = 0; weekStart < days.length; weekStart += 7) {
    const weekDays = days.slice(weekStart, weekStart + 7);
    const laneEnds: string[] = [];
    const weekMap = new Map<string, number>();

    for (const task of sorted) {
      if (!weekDays.some((day) => coversRange(task, day))) continue;
      let assigned = laneEnds.findIndex((endKey) => endKey < task.start_date);
      if (assigned === -1) {
        assigned = laneEnds.length;
        laneEnds.push(task.end_date);
      } else {
        laneEnds[assigned] = task.end_date;
      }
      weekMap.set(task.id, assigned);
    }

    result.set(weekStart, weekMap);
  }

  return result;
}

export function TaskCalendar({
  monthDate,
  onMonthChange,
  tasks,
  requests,
  selectedDates,
  onToggleDay,
  onClearSelection,
  onConfirmSelection,
  onSelectTask,
}: {
  monthDate: Date;
  onMonthChange: (date: Date) => void;
  tasks: Task[];
  requests: ScheduleRequest[];
  selectedDates: string[];
  onToggleDay: (key: string) => void;
  onClearSelection: () => void;
  onConfirmSelection: () => void;
  onSelectTask: (task: Task) => void;
}) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const { width } = useWindowDimensions();
  const narrow = width < 640;

  const days = useMemo(() => getMonthGrid(monthDate), [monthDate]);
  const dayStatus = useMemo(() => buildDayStatus(requests), [requests]);
  const weekLanes = useMemo(() => buildWeekLanes(tasks, days), [tasks, days]);
  const selected = useMemo(() => new Set(selectedDates), [selectedDates]);

  const statusColors = scheme === 'dark'
    ? { green: '#14532D', yellow: '#713F12', red: '#7F1D1D' }
    : { green: '#DCFCE7', yellow: '#FEF9C3', red: '#FEE2E2' };
  const dotColors = scheme === 'dark'
    ? { red: '#F87171', pending: '#F87171', green: '#4ADE80' }
    : { red: '#EF4444', pending: '#DC2626', green: '#22C55E' };

  const laneCountFor = (weekStart: number) => {
    const map = weekLanes.get(weekStart);
    if (!map || map.size === 0) return 0;
    return Math.max(...Array.from(map.values())) + 1;
  };

  return (
    <View style={{ gap: Spacing.two }}>
      <View style={styles.headerRow}>
        <View style={styles.navGroup}>
          <Pressable
            onPress={() => onMonthChange(addMonths(monthDate, -1))}
            accessibilityRole="button"
            accessibilityLabel="Previous month"
            style={[styles.navButton, { borderColor: theme.border }]}>
            <ThemedText type="small" themeColor="brandForeground">
              ‹
            </ThemedText>
          </Pressable>
          <ThemedText type="title" themeColor="brandForeground" style={styles.monthTitle}>
            {formatMonthLabel(monthDate)}
          </ThemedText>
          <Pressable
            onPress={() => onMonthChange(addMonths(monthDate, 1))}
            accessibilityRole="button"
            accessibilityLabel="Next month"
            style={[styles.navButton, { borderColor: theme.border }]}>
            <ThemedText type="small" themeColor="brandForeground">
              ›
            </ThemedText>
          </Pressable>
        </View>
        <Button
          label="Today"
          variant="outline"
          onPress={() => onMonthChange(new Date())}
        />
      </View>

      <View style={styles.weekRow}>
        {WEEKDAY_LABELS.map((label, index) => (
          <View key={index} style={styles.cell}>
            <ThemedText type="small" themeColor="mutedForeground" style={styles.weekdayLabel}>
              {label}
            </ThemedText>
          </View>
        ))}
      </View>

      <View style={styles.grid}>
        {days.map((day, dayIndex) => {
          const key = toDateKey(day);
          const weekStart = Math.floor(dayIndex / 7) * 7;
          const lanes = laneCountFor(weekStart);
          const laneMap = weekLanes.get(weekStart);
          const dayTasks = tasks.filter((task) => coversRange(task, day));
          const status = dayStatus.get(key);
          const isSelected = selected.has(key);
          const inMonth = isSameMonth(day, monthDate);

          const visibleLanes = Array.from({ length: lanes }, () => null as Task | null);
          let overflow = 0;
          for (const task of dayTasks) {
            const lane = laneMap?.get(task.id);
            if (lane === undefined) continue;
            if (lane < MAX_TASK_LANES) visibleLanes[lane] = task;
            else overflow += 1;
          }

          const cellHeight = Math.max(narrow ? 96 : 112, 40 + lanes * (LANE_HEIGHT + LANE_GAP));

          let background = 'transparent';
          if (isSelected) background = theme.primary;
          else if (status?.rejected) background = statusColors.red;
          else if (status && status.total > 0 && status.confirmed === status.total) background = statusColors.green;
          else if (status?.pending) background = statusColors.yellow;

          return (
            <Pressable
              key={key}
              onPress={() => onToggleDay(key)}
              accessibilityRole="button"
              accessibilityLabel={key}
              accessibilityState={{ selected: isSelected }}
              style={styles.cell}>
              <View
                style={[
                  styles.dayBox,
                  { minHeight: cellHeight, backgroundColor: background },
                  isToday(day) && !isSelected && { borderColor: theme.primary, borderWidth: 2 },
                ]}>
                <View style={styles.dayNumberRow}>
                  <ThemedText
                    type="small"
                    themeColor={isSelected ? 'primaryForeground' : 'brandForeground'}
                    style={!inMonth && !isSelected && styles.outsideMonth}>
                    {day.getDate()}
                  </ThemedText>
                  {!isSelected && status?.rejected ? (
                    <View style={[styles.statusDot, { backgroundColor: dotColors.red }]} />
                  ) : !isSelected && status && status.total > 0 && status.confirmed === status.total ? (
                    <View style={[styles.statusDot, { backgroundColor: dotColors.green }]} />
                  ) : !isSelected && status?.pending ? (
                    <View style={[styles.statusDot, { backgroundColor: dotColors.pending }]} />
                  ) : null}
                </View>

                {lanes > 0 && (
                  <View style={styles.lanesRow}>
                    {visibleLanes.map((task, laneIndex) => {
                      if (!task) {
                        return <View key={`empty-${laneIndex}`} style={styles.laneSlot} />;
                      }
                      const continuesFromPrev = dayIndex > 0 && coversRange(task, days[dayIndex - 1]);
                      const continuesToNext =
                        dayIndex < days.length - 1 && coversRange(task, days[dayIndex + 1]);
                      const isTaskStart = task.start_date === key;
                      const isRestartDay = day.getDay() === 0;
                      const showName = isTaskStart || (isRestartDay && !isTaskStart && continuesFromPrev);

                      return (
                        <Pressable
                          key={task.id}
                          onPress={(event) => {
                            event.stopPropagation();
                            onSelectTask(task);
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={task.name}
                          style={[
                            styles.bar,
                            {
                              backgroundColor: task.color || theme.primary,
                              marginLeft: continuesFromPrev ? -BAR_INSET : BAR_INSET,
                              marginRight: continuesToNext ? -BAR_INSET : BAR_INSET,
                              borderTopLeftRadius: continuesFromPrev ? 0 : 2,
                              borderTopRightRadius: continuesToNext ? 0 : 2,
                              borderBottomRightRadius: continuesToNext ? 0 : 2,
                              borderBottomLeftRadius: continuesFromPrev ? 0 : 2,
                            },
                          ]}>
                          {showName && (
                            <ThemedText
                              type="small"
                              numberOfLines={1}
                              style={[styles.barLabel, { fontSize: narrow ? 10 : 11 }]}>
                              {task.name}
                            </ThemedText>
                          )}
                        </Pressable>
                      );
                    })}
                    {overflow > 0 && (
                      <ThemedText type="small" themeColor="mutedForeground" style={styles.overflow}>
                        +{overflow}
                      </ThemedText>
                    )}
                  </View>
                )}
              </View>
            </Pressable>
          );
        })}
      </View>

      {selectedDates.length > 0 && (
        <View style={[styles.selectionBar, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="small" themeColor="mutedForeground">
            {selectedDates.length} date{selectedDates.length === 1 ? '' : 's'} selected
          </ThemedText>
          <View style={styles.selectionActions}>
            <Button label="Clear" variant="outline" onPress={onClearSelection} />
            <Button label="Create task" onPress={onConfirmSelection} />
          </View>
        </View>
      )}

      {tasks.length > 0 && (
        <View style={{ gap: Spacing.one, marginTop: Spacing.two }}>
          <ThemedText type="smallBold" themeColor="mutedForeground">
            Active tasks
          </ThemedText>
          {tasks.slice(0, 5).map((task) => (
            <View key={task.id} style={styles.legendRow}>
              <View
                style={[styles.legendBar, { backgroundColor: task.color || theme.primary }]}
              />
              <ThemedText
                type="small"
                themeColor="mutedForeground"
                numberOfLines={1}
                style={styles.legendName}>
                {task.name}
              </ThemedText>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    alignItems: 'center',
    flexDirection: 'row',
    height: LANE_HEIGHT,
    overflow: 'hidden',
    paddingLeft: 4,
  },
  barLabel: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  cell: {
    paddingHorizontal: BAR_INSET,
    width: `${100 / 7}%`,
  },
  dayBox: {
    borderRadius: Radius.md,
    gap: LANE_GAP,
    paddingHorizontal: 3,
    paddingTop: 4,
  },
  dayNumberRow: {
    alignItems: 'center',
    flexDirection: 'row',
    height: 18,
    justifyContent: 'space-between',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: BAR_INSET,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  laneSlot: {
    height: LANE_HEIGHT,
  },
  lanesRow: {
    flexDirection: 'column',
    gap: LANE_GAP,
    paddingBottom: 4,
    paddingTop: 2,
  },
  legendBar: {
    borderRadius: Radius.full,
    flex: 1,
    height: 8,
    opacity: 0.6,
  },
  legendName: {
    maxWidth: 96,
  },
  legendRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.two,
  },
  monthTitle: {
    textAlign: 'center',
  },
  navButton: {
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  navGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.two,
  },
  outsideMonth: {
    opacity: 0.5,
  },
  overflow: {
    fontSize: 10,
    textAlign: 'center',
  },
  selectionActions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  selectionBar: {
    alignItems: 'center',
    borderRadius: Radius.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing.two,
    padding: Spacing.two,
  },
  statusDot: {
    borderRadius: Radius.full,
    height: 10,
    marginRight: 2,
    width: 10,
  },
  weekRow: {
    flexDirection: 'row',
  },
  weekdayLabel: {
    fontWeight: '600',
    paddingVertical: Spacing.two,
    textAlign: 'center',
  },
});