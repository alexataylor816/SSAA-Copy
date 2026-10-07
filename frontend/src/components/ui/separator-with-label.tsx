import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function SeparatorWithLabel({ label }: { label: string }) {
  const theme = useTheme();

  return (
    <View style={styles.row}>
      <View style={[styles.line, { backgroundColor: theme.border }]} />
      <ThemedText type="small" themeColor="mutedForeground">
        {label}
      </ThemedText>
      <View style={[styles.line, { backgroundColor: theme.border }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.two,
    width: '100%',
  },
});
