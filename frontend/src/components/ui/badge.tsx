import { StyleSheet, View, type ViewProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type BadgeProps = ViewProps & {
  label: string;
  variant?: 'default' | 'secondary' | 'outline';
};

// Matches shadcn/ui's Badge: rounded-full border px-2.5 py-0.5 text-xs font-semibold
// (SSAA/src/components/ui/badge.tsx).
export function Badge({ label, variant = 'default', style, ...rest }: BadgeProps) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.base,
        variant === 'default' && { backgroundColor: theme.primary, borderColor: theme.primary },
        variant === 'secondary' && { backgroundColor: theme.secondary, borderColor: theme.secondary },
        variant === 'outline' && { backgroundColor: 'transparent', borderColor: theme.border },
        style,
      ]}
      {...rest}>
      <ThemedText
        style={[
          styles.label,
          variant === 'default' && { color: theme.primaryForeground },
          variant === 'secondary' && { color: theme.secondaryForeground },
          variant === 'outline' && { color: theme.brandForeground },
        ]}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: 'flex-start',
    borderRadius: Radius.full,
    borderWidth: 1,
    paddingHorizontal: Spacing.two + Spacing.half,
    paddingVertical: Spacing.half,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
});
