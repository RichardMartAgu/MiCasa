import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform, StyleSheet, View, type ColorValue } from 'react-native';

import { Palette, Radius, Shadow } from '@/constants/theme';
import { InstallPromptBanner } from '@/components/install-prompt-banner';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/context/auth-context';
import { useNotificationSync } from '@/hooks/use-notification-sync';

function icon(name: keyof typeof Ionicons.glyphMap) {
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color} size={size} />;
  }
  return TabIcon;
}

export default function TabsLayout() {
  const { session, loading } = useAuth();
  useNotificationSync();

  if (loading) return <Spinner fullScreen />;
  if (!session) return <Redirect href="/login" />;

  return (
    <View style={styles.pantalla}>
      {/* Arriba de las pestañas y en cualquier pantalla: el aviso tiene que
          aparecer donde la persona ya está, no solo en Inicio. */}
      <InstallPromptBanner />
      <Tabs
      screenOptions={{
        tabBarActiveTintColor: Palette.primary,
        tabBarInactiveTintColor: Palette.textMuted,
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarItemStyle: styles.tabBarItem,
      }}>
      <Tabs.Screen name="index" options={{ title: 'Inicio', tabBarIcon: icon('home-outline') }} />
      <Tabs.Screen name="citas" options={{ title: 'Citas', tabBarIcon: icon('calendar-outline') }} />
      <Tabs.Screen name="gastos" options={{ title: 'Gastos', tabBarIcon: icon('wallet-outline') }} />
      <Tabs.Screen name="listas" options={{ title: 'Listas', tabBarIcon: icon('cart-outline') }} />
      <Tabs.Screen
        name="cumpleanos"
        options={{ title: 'Cumpleaños', tabBarIcon: icon('gift-outline') }}
      />
      <Tabs.Screen name="ajustes" options={{ title: 'Ajustes', tabBarIcon: icon('settings-outline') }} />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  pantalla: { flex: 1 },
  tabBar: {
    backgroundColor: Palette.surface,
    borderTopColor: Palette.border,
    borderTopWidth: 1,
    height: Platform.OS === 'web' ? 64 : 60,
    paddingTop: 6,
    ...Shadow.card,
  },
  tabBarItem: {
    borderRadius: Radius.md,
  },
});
