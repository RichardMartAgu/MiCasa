import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from '@/context/auth-context';
import { CasaProvider } from '@/context/casa-context';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <CasaProvider>
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="login" />
            <Stack.Screen name="register" />
            <Stack.Screen name="(tabs)" />
          </Stack>
        </CasaProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
