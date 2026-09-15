import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SplashScreenView } from '@/components/splash-screen';
import { AuthProvider, useAuth } from '@/context/auth-context';
import { CasaProvider } from '@/context/casa-context';

const SPLASH_MIN_MS = 2200;

function RootNavigator() {
  const { loading } = useAuth();
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMinTimeElapsed(true), SPLASH_MIN_MS);
    return () => clearTimeout(timer);
  }, []);

  if (loading || !minTimeElapsed) {
    return <SplashScreenView />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <CasaProvider>
          <StatusBar style="light" />
          <RootNavigator />
        </CasaProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}