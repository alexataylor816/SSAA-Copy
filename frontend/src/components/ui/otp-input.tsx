import { useRef } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface OtpInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
}

export function OtpInput({ length = 6, value, onChange }: OtpInputProps) {
  const theme = useTheme();
  const inputs = useRef<(TextInput | null)[]>([]);

  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  const setDigit = (index: number, text: string) => {
    const clean = text.replace(/[^0-9]/g, '');

    if (clean.length > 1) {
      // The whole code was pasted/autofilled into one box.
      onChange(clean.slice(0, length));
      inputs.current[Math.min(clean.length, length) - 1]?.focus();
      return;
    }

    const next = digits.slice();
    next[index] = clean;
    onChange(next.join(''));

    if (clean && index < length - 1) {
      inputs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (index: number, key: string) => {
    if (key === 'Backspace' && !digits[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  };

  return (
    <View style={styles.row}>
      {digits.map((digit, index) => (
        <TextInput
          key={index}
          ref={(ref) => {
            inputs.current[index] = ref;
          }}
          style={[styles.box, { borderColor: theme.border, color: theme.brandForeground }]}
          value={digit}
          onChangeText={(text) => setDigit(index, text)}
          onKeyPress={({ nativeEvent }) => handleKeyPress(index, nativeEvent.key)}
          keyboardType="number-pad"
          maxLength={length}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: Spacing.two,
    borderWidth: 1,
    fontSize: 20,
    fontWeight: '600',
    height: 52,
    textAlign: 'center',
    width: 44,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
    justifyContent: 'center',
  },
});
