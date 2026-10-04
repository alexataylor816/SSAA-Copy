import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type TextFieldProps = TextInputProps & {
  label: string;
  secureToggle?: boolean;
};

// Matches shadcn/ui's Input: h-10 px-3 rounded-md border-input
// (SSAA/src/components/ui/input.tsx).
export function TextField({ label, secureToggle, secureTextEntry, style, ...rest }: TextFieldProps) {
  const theme = useTheme();
  const [hidden, setHidden] = useState(secureToggle ? (secureTextEntry ?? true) : !!secureTextEntry);

  return (
    <View style={styles.wrapper}>
      <ThemedText type="small" themeColor="mutedForeground">
        {label}
      </ThemedText>
      <View style={styles.inputRow}>
        <TextInput
          style={[
            styles.input,
            {
              borderColor: theme.border,
              color: theme.brandForeground,
              paddingRight: secureToggle ? Spacing.five : Spacing.three - Spacing.one,
            },
            style,
          ]}
          placeholderTextColor={theme.muted}
          secureTextEntry={secureToggle ? hidden : secureTextEntry}
          {...rest}
        />
        {secureToggle && (
          <Pressable style={styles.toggle} onPress={() => setHidden((v) => !v)}>
            <ThemedText type="small" themeColor="primary">
              {hidden ? 'Show' : 'Hide'}
            </ThemedText>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    borderRadius: Radius.md,
    borderWidth: 1,
    fontSize: 14,
    height: 40,
    paddingHorizontal: Spacing.three - Spacing.one,
    width: '100%',
  },
  inputRow: {
    justifyContent: 'center',
    width: '100%',
  },
  toggle: {
    position: 'absolute',
    right: Spacing.three,
  },
  wrapper: {
    gap: Spacing.one,
    width: '100%',
  },
});
