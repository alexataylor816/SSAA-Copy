import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { TextLink } from '@/components/ui/text-link';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

function goBack() {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace('/');
  }
}

export function LegalScreen({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const theme = useTheme();

  return (
    <ScrollView style={{ backgroundColor: theme.brandBackground }}>
      <SafeAreaView style={styles.content}>
        <TextLink label="← Back" onPress={goBack} />

        <ThemedText type="title" themeColor="brandForeground" style={styles.title}>
          {title}
        </ThemedText>
        {subtitle && (
          <ThemedText type="small" themeColor="mutedForeground">
            {subtitle}
          </ThemedText>
        )}

        <View style={styles.article}>{children}</View>
      </SafeAreaView>
    </ScrollView>
  );
}

export function LegalSection({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold" themeColor="brandForeground">
        {heading}
      </ThemedText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  article: {
    gap: Spacing.four,
    paddingTop: Spacing.two,
  },
  content: {
    alignSelf: 'center',
    gap: Spacing.three,
    maxWidth: 720,
    padding: Spacing.four,
    width: '100%',
  },
  section: {
    gap: Spacing.two,
  },
  title: {
    fontSize: 32,
    lineHeight: 38,
  },
});
