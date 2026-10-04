import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  addMonths,
  formatMonthLabel,
  getMonthGrid,
  isDateLocked,
  isSameMonth,
  isToday,
  toDateKey,
} from '@/lib/calendar';
import { TextLink } from '@/components/ui/text-link';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function CalendarGrid({
  monthDate,
  onMonthChange,
  countByDate,
  onSelectDay,
}: {
  monthDate: Date;
  onMonthChange: (date: Date) => void;
  countByDate: Record<string, number>;
  onSelectDay: (date: Date) => void;
}) {
  const theme = useTheme();
  const days = getMonthGrid(monthDate);

  return (
    <View style={{ gap: Spacing.three }}>
      <View style={styles.header}>
        <TextLink label="‹ Prev" onPress={() => onMonthChange(addMonths(monthDate, -1))} />
        <ThemedText type="smallBold" themeColor="brandForeground">
          {formatMonthLabel(monthDate)}
        </ThemedText>
        <TextLink label="Next ›" onPress={() => onMonthChange(addMonths(monthDate, 1))} />
      </View>

      <View style={styles.weekRow}>
        {WEEKDAY_LABELS.map((label, i) => (
          <View key={i} style={styles.cell}>
            <ThemedText type="small" themeColor="mutedForeground" style={styles.weekdayLabel}>
              {label}
            </ThemedText>
          </View>
        ))}
      </View>

      <View style={styles.grid}>
        {days.map((day) => {
          const key = toDateKey(day);
          const inMonth = isSameMonth(day, monthDate);
          const count = countByDate[key] ?? 0;
          const locked = isDateLocked(day);

          return (
            <Pressable key={key} onPress={() => onSelectDay(day)} style={styles.cell}>
              <View
                style={[
                  styles.dayBox,
                  isToday(day) && { borderColor: theme.primary, borderWidth: 1 },
                  locked && { backgroundColor: theme.muted + '22' },
                ]}>
                <ThemedText
                  type="small"
                  themeColor={inMonth ? 'brandForeground' : 'mutedForeground'}
                  style={!inMonth && styles.dimmed}>
                  {day.getDate()}
                </ThemedText>
                {count > 0 && (
                  <View style={[styles.badge, { backgroundColor: theme.primary }]}>
                    <ThemedText type="small" style={{ color: theme.primaryForeground, fontSize: 11 }}>
                      {count}
                    </ThemedText>
                  </View>
                )}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    borderRadius: Radius.full,
    justifyContent: 'center',
    minWidth: 18,
    paddingHorizontal: Spacing.half,
  },
  cell: {
    alignItems: 'center',
    width: `${100 / 7}%`,
  },
  dayBox: {
    alignItems: 'center',
    borderRadius: Radius.sm,
    gap: Spacing.half,
    justifyContent: 'center',
    paddingVertical: Spacing.two,
    width: '90%',
  },
  dimmed: {
    opacity: 0.4,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  weekRow: {
    flexDirection: 'row',
  },
  weekdayLabel: {
    fontWeight: '600',
  },
});
