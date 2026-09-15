import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Palette, Spacing } from '@/constants/theme';

export function NoCasaState() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <EmptyState
        icon="home-outline"
        title="Crea una casa primero"
        subtitle="Necesitas una casa para gestionar citas, gastos, listas y cumpleaños."
      />
      <Button title="Ir a Ajustes" onPress={() => router.navigate('/ajustes')} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
});