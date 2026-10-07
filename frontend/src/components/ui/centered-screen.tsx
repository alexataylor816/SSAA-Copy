import { ScrollView, StyleSheet, type ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function CenteredScreen({ style, ...rest }: ViewProps) {
  const theme = useTheme();

  return (
    <ScrollView
      style={{ backgroundColor: theme.brandBackground }}
      contentContainerStyle={styles.scrollContent}>
      <SafeAreaView style={[styles.content, style]} {...rest} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    alignItems: 'center',
    alignSelf: 'center',
    gap: Spacing.four,
    maxWidth: 440,
    padding: Spacing.four,
    width: '100%',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: '100%',
  },
});
