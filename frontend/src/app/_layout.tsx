import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { Provider, useDispatch, useSelector } from 'react-redux';

import { loadPersistedAuth } from '@/store/authStorage';
import { store, type RootState } from '@/store/store';

function AuthHydrator() {
  const dispatch = useDispatch();
  const hydrated = useSelector((state: RootState) => state.auth.hydrated);

  // Hydrate here rather than per-screen: app.json sets web.output to "static",
  // so a refresh or deep link straight to /dashboard or /onboarding mounted
  // those screens with hydrated === false forever and they hung on "Loading…".
  useEffect(() => {
    if (!hydrated) {
      void loadPersistedAuth(dispatch);
    }
  }, [dispatch, hydrated]);

  return null;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <Provider store={store}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AuthHydrator />
        <Stack screenOptions={{ headerShown: false }} />
        <StatusBar style="auto" />
      </ThemeProvider>
    </Provider>
  );
}