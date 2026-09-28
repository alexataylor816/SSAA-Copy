import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type TextFieldProps = TextInputProps & {
  label: string;
  secureToggle?: boolean;
};

export function TextField({ label, secureToggle, secureTextEntry, style, ...rest }: TextFieldProps) {
  const theme = useTheme();
  const [hidden, setHidden] = useState(!!secureTextEntry);

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
              paddingRight: secureToggle ? Spacing.five : Spacing.three,
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
    borderRadius: Spacing.two,
    borderWidth: 1,
    fontSize: 16,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
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
