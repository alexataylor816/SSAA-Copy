import { router } from 'expo-router';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { CenteredScreen } from '@/components/ui/centered-screen';
import { TextLink } from '@/components/ui/text-link';
import { Spacing } from '@/constants/theme';

export default function NotFoundScreen() {
  return (
    <CenteredScreen>
      <View style={{ alignItems: 'center', gap: Spacing.two }}>
        <ThemedText type="title" themeColor="brandForeground">
          404
        </ThemedText>
        <ThemedText type="default" themeColor="mutedForeground">
          This page doesn’t exist.
        </ThemedText>
        <TextLink label="Return home" onPress={() => router.replace('/')} />
      </View>
    </CenteredScreen>
  );
}
