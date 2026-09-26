import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Palette, Radius, Shadow, Spacing } from '@/constants/theme';
import { showNotice } from '@/lib/notice';
import { useAppInstall } from '@/hooks/use-app-install';

/**
 * Aviso-emergente para instalar la app, arriba del todo y en cualquier pantalla.
 *
 * Existe porque la tarjeta de Ajustes es un sitio donde nadie llega buscando
 * instalar nada: se entra a Ajustes a cambiar los recordatorios, no a poner un
 * icono en la pantalla de inicio. Y porque el aviso del navegador aparece una vez
 * y se ignora, sin dar ninguna señal de que se puede volver a pedir.
 *
 * Solo se enseña si el navegador ha dicho que puede instalar, así que el botón
 * funciona de verdad. Donde no existe ese evento, que es iPhone, no se enseña
 * nada: en Ajustes está la tarjeta con los pasos de esa plataforma.
 */
export function InstallPromptBanner() {
  const appInstall = useAppInstall();
  // `listo` es el reloj, `shouldAsk` es la decisión, y se pintan los dos juntos.
  // Separarlos obligaba a un `setVisible(false)` dentro del efecto, que es
  // precisely lo que la regla de hooks no admite, y además podía hacer que el
  // aviso apareciera un fotograma y se escondiera.
  const [listo, setListo] = useState(false);

  // Se espera un instante antes de enseñarlo. El evento llega en cuanto el
  // navegador cumple los criterios, que suele ser nada más cargar, y un cartel
  // que empuja el contenido mientras la persona está leyendo no se lee.
  useEffect(() => {
    const temporizador = setTimeout(() => setListo(true), 1200);
    return () => clearTimeout(temporizador);
  }, []);

  if (!listo || !appInstall.shouldAsk) return null;

  async function instalar() {
    const decision = await appInstall.install();
    if (decision === 'no') {
      showNotice(
        'Se instala desde el navegador',
        'Abre el menú del navegador y elige la opción de instalar. En Ajustes tienes los pasos.',
      );
      return;
    }
    if (decision === 'si') {
      // Ni "instalada" ni "hecho": aceptar el diálogo no es instalar. Se espera a
      // que el navegador confirme, y mientras tanto se dice lo único que es
      // cierto, que es que se está instalando.
      showNotice(
        'Se está instalando',
        'El icono aparecerá en tu pantalla de inicio. Si no aparece en un rato, vuelve a instalar desde el menú del navegador.',
      );
    }
  }

  function ahoraNo() {
    appInstall.decideAskAgain('no');
  }

  function noPreguntarMas() {
    appInstall.decideAskAgain('no-preguntar-mas');
  }

  return (
    <View style={styles.contenedor} accessibilityRole="alert">
      <View style={styles.tarjeta}>
        <View style={styles.cabecera}>
          <Ionicons name="download-outline" size={20} color={Palette.accent} />
          <Text style={styles.titulo}>¿Quieres MiCasa en tu pantalla de inicio?</Text>
          <Pressable
            onPress={noPreguntarMas}
            accessibilityRole="button"
            accessibilityLabel="No preguntar más"
            hitSlop={8}
            style={styles.cerrar}>
            <Ionicons name="close" size={18} color={Palette.textSecondary} />
          </Pressable>
        </View>
        <Text style={styles.texto}>
          Se abre con su propio icono y sin barra del navegador, y los avisos de citas y cumpleaños llegan
          aunque la cierres.
        </Text>
        <View style={styles.acciones}>
          <Button title="Instalar" size="sm" onPress={() => void instalar()} />
          <Button title="Ahora no" variant="ghost" size="sm" onPress={ahoraNo} />
        </View>
        <Pressable onPress={noPreguntarMas} accessibilityRole="button" hitSlop={6}>
          <Text style={styles.noMas}>No preguntar más</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Envuelve la pantalla en vez de flotar con `position: absolute`: el aviso tiene
  // que empujar el contenido, no taparlo. Flotando se acaba saliendo de la
  // ventana, y en web el botón acaba debajo de la barra de pestañas.
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
  cerrar: { padding: Spacing.half },
  texto: { fontSize: 13, lineHeight: 18, color: Palette.textSecondary },
  acciones: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  noMas: { fontSize: 12, color: Palette.textMuted, textAlign: 'center' },
});
