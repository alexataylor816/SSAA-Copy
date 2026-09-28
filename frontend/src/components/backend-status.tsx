import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useGetHealthQuery } from '@/store/api/health';

export function BackendStatus() {
  const theme = useTheme();
  const { data, isError, isFetching, refetch } = useGetHealthQuery(undefined, {
    pollingInterval: 5000,
  });

  const connected = isError ? false : data?.status === 'ok';
  const dotColor = isError ? '#ef4444' : connected ? '#22c55e' : theme.textSecondary;

  const label = isError
    ? 'Backend unreachable — is the API running on :8000?'
    : data
      ? `Connected · ${data.db}`
      : isFetching
        ? 'Connecting to backend…'
        : 'Connecting to backend…';

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
        <ThemedText type="smallBold">Backend status</ThemedText>
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <Pressable
        onPress={() => refetch()}
        style={({ pressed }) => [pressed && styles.pressed]}>
        <ThemedText type="linkPrimary">Retry</ThemedText>
      </Pressable>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    borderRadius: Spacing.three,
    gap: Spacing.two,
    maxWidth: 480,
    padding: Spacing.four,
    width: '100%',
  },
  dot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  pressed: {
    opacity: 0.6,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.two,
  },
});