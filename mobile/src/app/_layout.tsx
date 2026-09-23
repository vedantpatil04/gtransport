import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthGate } from '../features/auth/AuthGate';
import i18n, { initI18n, languageFromApi, setLanguage } from '../i18n';
import { useSession } from '../lib/auth/session-store';
import { colors } from '../theme/tokens';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const restore = useSession((s) => s.restore);

  useEffect(() => {
    (async () => {
      // Translations and any saved session load before the first frame, so the driver never
      // sees an English flash or a login screen they do not need.
      await initI18n();
      await restore();
      setReady(true);
    })().catch(() => setReady(true));
  }, [restore]);

  // A driver whose office record says Kannada gets Kannada, unless they chose otherwise here.
  const driverLanguage = useSession((s) => s.driver?.employee.preferredLanguage);
  useEffect(() => {
    (async () => {
      const fromApi = languageFromApi(driverLanguage);
      const { readStoredLanguage } = await import('../i18n');
      if (fromApi && !(await readStoredLanguage())) await setLanguage(fromApi);
    })().catch(() => undefined);
  }, [driverLanguage]);

  const onReady = useCallback(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <I18nextProvider i18n={i18n}>
        <View style={styles.root} onLayout={onReady}>
          <StatusBar style="light" />
          <AuthGate>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="(auth)/login" />
            </Stack>
          </AuthGate>
        </View>
      </I18nextProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.background } });
