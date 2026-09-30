import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as Network from 'expo-network';
import * as Notifications from 'expo-notifications';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiError } from '../src/lib/api';
import { loadLanguage, type Lang } from '../src/lib/i18n';
import { useForegroundRefresh } from '../src/lib/hooks';
import { AuthProvider } from '../src/state/auth';
import { LangContext } from '../src/state/lang';
import { colors } from '../src/theme';

void SplashScreen.preventAutoHideAsync();

// Lock-screen safe: notifications carry no photos or sensitive data (server-side templates).
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

onlineManager.setEventListener((setOnline) => {
  const sub = Network.addNetworkStateListener((s) => setOnline(!!s.isConnected && s.isInternetReachable !== false));
  return () => sub.remove();
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
      staleTime: 5_000,
      // Eligibility must never be served stale as if confirmed: always refetch on mount/focus.
      refetchOnMount: 'always',
      refetchOnWindowFocus: true,
    },
  },
});

function Foreground() {
  useForegroundRefresh();
  return null;
}

export default function RootLayout() {
  const [lang, setLang] = useState<Lang | null>(null);
  useEffect(() => {
    loadLanguage().then((l) => {
      setLang(l);
      void SplashScreen.hideAsync();
    });
  }, []);
  if (!lang) return null;
  return (
    <SafeAreaProvider>
      <LangContext.Provider value={lang}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <Foreground />
            <StatusBar style="dark" />
            <Stack screenOptions={{ headerTintColor: colors.navy, headerBackTitle: '', contentStyle: { backgroundColor: colors.bg } }}>
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="(auth)" options={{ headerShown: false }} />
              <Stack.Screen name="(user)" options={{ headerShown: false }} />
              <Stack.Screen name="(merchant)" options={{ headerShown: false }} />
              <Stack.Screen name="approval" options={{ presentation: 'modal', title: '' }} />
            </Stack>
          </AuthProvider>
        </QueryClientProvider>
      </LangContext.Provider>
    </SafeAreaProvider>
  );
}
