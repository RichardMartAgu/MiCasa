import { Ionicons } from '@expo/vector-icons';
import { useSyncExternalStore } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Palette, Radius, Shadow, Spacing } from '@/constants/theme';
import {
  aplicarActualizacion,
  descartarVersion,
  leerPendiente,
  suscribir,
} from '@/lib/sw-update';

/**
 * Aviso de que hay una versión nueva, con un botón para aplicarla.
 *
 * Va en el mismo sitio que el aviso de instalar, y empuja el contenido en vez de
 * taparlo.
 *
 * La razón de que exista: un service worker nuevo **no** se activa solo, porque
 * activar uno nuevo con pestañas viejas abiertas es peligroso. Eso es correcto,
 * y también es un atasco: el worker nuevo se queda esperando, y el usuario sigue
 * con el bundle de su primer despliegue sin que nada lo diga. El aviso es la
 * salida: quien decide cuándo activar es la persona, porque recargar a alguien
 * con un formulario a medio rellenar no es una actualización, es perder trabajo.
 */
export function UpdateNotice() {
  const pendiente = useSyncExternalStore(suscribir, leerPendiente, () => false);

  if (Platform.OS !== 'web' || !pendiente) return null;

  return (
    <View style={styles.contenedor} accessibilityRole="alert">
      <View style={styles.tarjeta}>
        <View style={styles.cabecera}>
          <Ionicons name="cloud-download-outline" size={20} color={Palette.accent} />
          <Text style={styles.titulo}>Hay una versión nueva de MiCasa</Text>
        </View>
        <Text style={styles.texto}>
          Para que se vea lo último hay que recargar esta página. Si estabas escribiendo algo, guárdalo antes.
        </Text>
        <View style={styles.acciones}>
          <Button title="Recargar" size="sm" onPress={aplicarActualizacion} />
          {/* Sin salida, un aviso es un sitio donde no se puede decir que no. El
              de instalar tiene tres; este tenía ninguna. */}
          <Button title="Más tarde" variant="ghost" size="sm" onPress={descartarVersion} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two },
  tarjeta: {
    backgroundColor: Palette.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.borderStrong,
    padding: Spacing.three,
    gap: Spacing.two,
    ...Shadow.card,
  },
  cabecera: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  titulo: { flex: 1, fontSize: 15, fontWeight: '700', color: Palette.textStrong },
  texto: { fontSize: 13, lineHeight: 18, color: Palette.textSecondary },
  acciones: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
});
