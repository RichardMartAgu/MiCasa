import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { ColorValue } from 'react-native';

import { useAuth } from '@/context/auth-context';

function icon(name: keyof typeof Ionicons.glyphMap) {
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color} size={size} />;
  }
  return TabIcon;
}

export default function TabsLayout() {
  const { session } = useAuth();

  if (!session) return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#3c87f7',
        tabBarInactiveTintColor: '#9ca3af',
        headerShown: false,
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
  );
}
