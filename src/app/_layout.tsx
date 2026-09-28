import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorBoundary } from '@/components/error-boundary';
import { UpdateNotice } from '@/components/update-notice';
import { SplashScreenView } from '@/components/splash-screen';
import { AuthProvider, useAuth } from '@/context/auth-context';
import { CasaProvider } from '@/context/casa-context';
import { attach } from '@/lib/install-prompt';
import { vigilarActualizacion } from '@/lib/sw-update';

// Engancha el almacén del evento de instalación de la PWA, y lo hace **aquí** a
// propósito. El listener tiene que estar puesto antes de que el navegador lance
// `beforeinstallprompt`, que solo ocurre una vez por carga; el layout raíz es lo
// único que Expo Router evalúa al arrancar, porque las pantallas se cargan bajo
// demanda. Si el enganche viviera en la pantalla de Ajustes, llegaría después del
// evento, se perdería, y la tarjeta diría "este navegador no puede instalarla" en
// un Chrome que sí puede.
//
// El módulo también se engancha al importarse, así que esto es una segunda red.
// Se deja la llamada explícita y no como import de efecto secundario por dos
// motivos: un import que no se usa parece código muerto y alguien lo borra, y así
// queda a la vista que el enganche es intencionado. `attach()` es idempotente.
attach();

// La vigilancia de actualizaciones va aquí, y no en la pantalla que pinta el
// aviso, por el mismo motivo que `attach()`: en `/login` o `/registro` no hay
// layout de pestañas, y son justo las pantallas por las que se entra después de
// un despliegue. Si el enganche viviera en `(tabs)`, alguien que actualiza y
// tiene que iniciar sesión otra vez no se entera de que hay versión nueva.
vigilarActualizacion();

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

  return (
    <View style={styles.pantalla}>
      {/* Aquí y no dentro de `(tabs)`, que es donde estaba antes: en login y en
          registro no hay layout de pestañas, y son las pantallas por las que se
          entra después de un despliegue. Empuja el contenido en vez de taparlo,
          como el aviso de instalar. */}
      <UpdateNotice />
      <Stack
        screenOptions={{
          headerShown: false,
          gestureEnabled: true,
          fullScreenGestureEnabled: true,
        }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="register" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <AuthProvider>
          <CasaProvider>
            <StatusBar style="light" />
            <RootNavigator />
          </CasaProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  pantalla: { flex: 1 },
});
