import { Pressable, StyleSheet, type PressableProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';

export type TextLinkProps = PressableProps & {
  label: string;
};

export function TextLink({ label, ...rest }: TextLinkProps) {
  return (
    <Pressable style={({ pressed }) => [pressed && styles.pressed]} {...rest}>
      <ThemedText type="small" themeColor="primary">
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.6,
  },
});
