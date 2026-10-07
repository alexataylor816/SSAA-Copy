import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { PermissionLevel } from '@/store/api/rbac';

const SHORT_LABELS: Record<PermissionLevel, string> = {
  basic: 'Basic',
  level_1: 'Lvl 1',
  partial: 'Partial',
  full: 'Full',
  account_holder: 'Holder',
};

export function PermissionPicker({
  levels,
  value,
  onChange,
}: {
  levels: PermissionLevel[];
  value: PermissionLevel;
  onChange: (level: PermissionLevel) => void;
}) {
  const theme = useTheme();

  return (
    <View style={styles.row}>
      {levels.map((level) => {
        const selected = level === value;
        return (
          <Pressable
            key={level}
            onPress={() => onChange(level)}
            style={[
              styles.chip,
              { borderColor: theme.border },
              selected && { backgroundColor: theme.primary, borderColor: theme.primary },
            ]}>
            <ThemedText type="small" style={{ color: selected ? theme.primaryForeground : theme.mutedForeground }}>
              {SHORT_LABELS[level]}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: Spacing.two,
    borderWidth: 1,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
});
