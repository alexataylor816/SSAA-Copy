import { Platform, StyleSheet, type ViewProps } from 'react-native';

import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Matches shadcn/ui's Card: rounded-lg border bg-card shadow-sm
// (SSAA/src/components/ui/card.tsx), with CardHeader/Content's p-6 default padding.
export function Card({ style, ...rest }: ViewProps) {
  const theme = useTheme();

  return <ThemedView type="card" style={[styles.card, { borderColor: theme.border }, style]} {...rest} />;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    gap: Spacing.four,
    padding: Spacing.four,
    width: '100%',
    ...Platform.select({
      web: { boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)' },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
      },
    }),
  },
});
