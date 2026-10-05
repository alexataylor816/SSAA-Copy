import { ActivityIndicator, Pressable, StyleSheet, type PressableProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ButtonProps = PressableProps & {
  label: string;
  variant?: 'primary' | 'outline';
  loading?: boolean;
};

// Matches shadcn/ui's default Button: h-10 px-4 rounded-md text-sm font-medium
// (SSAA/src/components/ui/button.tsx). Content-sized by default — pass
// style={{ width: '100%' }} for the form-submit buttons that want w-full.
export function Button({ label, variant = 'primary', loading, disabled, style, ...rest }: ButtonProps) {
  const theme = useTheme();
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      style={(state) => [
        styles.base,
        variant === 'primary' && { backgroundColor: theme.primary },
        variant === 'outline' && { backgroundColor: 'transparent', borderColor: theme.border, borderWidth: 1 },
        isDisabled && styles.disabled,
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? theme.primaryForeground : theme.primary} />
      ) : (
        <ThemedText
          type="small"
          style={variant === 'primary' ? { color: theme.primaryForeground } : { color: theme.brandForeground }}>
          {label}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: Radius.md,
    height: 40,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  disabled: {
    opacity: 0.6,
  },
});
