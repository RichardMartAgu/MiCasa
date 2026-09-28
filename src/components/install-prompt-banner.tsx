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

  // El retardo es para el *pregunto*, no para el veredicto: si alguien instala
  // desde Ajustes durante el primer segundo y medio, el resultado tiene que verse
  // igual. Con el retardo delante, ese intento se quedaba sin nada que lo
  // explicara, que es el hueco que este bloque vino a cerrar.
  const preguntando = listo && appInstall.shouldAsk;
  const conVeredicto =
    appInstall.installing ||
    appInstall.veredicto === 'sin-confirmar' ||
    appInstall.veredicto === 'confirmada';
  if (!preguntando && !conVeredicto) return null;

  async function instalar() {
    const decision = await appInstall.install();
    if (decision === 'cerrada') {
      showNotice(
        'Instalación cancelada',
        'Has cerrado el diálogo del navegador sin instalar. Pulsa otra vez y acepta cuando Chrome te lo pregunte.',
      );
      return;
    }
    if (decision === 'no-permitido') {
      showNotice(
        'No se puede pedir desde aquí',
        'Este navegador no deja pedir la instalación con un botón. Suele estar en su menú, y en Ajustes tienes los pasos.',
      );
      return;
    }
    if (decision === 'todavia-no') {
      showNotice(
        'Se instala desde el navegador',
        'Abre el menú del navegador y elige la opción de instalar. En Ajustes tienes los pasos.',
      );
    }
    // Con 'si' no se avisa: el veredicto se pinta en esta misma tarjeta. Antes
    // se mostraba un alert y, además, el aviso desaparecía —al gastarse el
    // evento el componente se escondía— sin que nada ocupara su sitio. El
    // resultado era que el proceso de instalar no se veía acabar nunca.
  }

  function ahoraNo() {
    appInstall.decideAskAgain('no');
  }

  function noPreguntarMas() {
    appInstall.decideAskAgain('no-preguntar-mas');
  }

  if (conVeredicto && appInstall.veredicto !== 'confirmada') {
    return (
      <View style={styles.contenedor} accessibilityRole="alert">
        <View style={styles.tarjeta}>
          <View style={styles.cabecera}>
            <Ionicons
              name={appInstall.installing ? 'hourglass-outline' : 'help-circle-outline'}
              size={20}
              color={Palette.accent}
            />
            <Text style={styles.titulo}>
              {appInstall.installing ? 'Instalando MiCasa…' : 'No hemos podido confirmar la instalación'}
            </Text>
            {/* Mientras se está instalando no hay cierre. El cierre cancelaba el
                temporizador que informa de "no hemos podido confirmar", así que
                tocarlo dejaba la pantalla sin ninguna señal de lo que estaba
                pasando. Y con el evento ya gastado no aparecía nada en su lugar. */}
            {appInstall.installing ? null : (
              <Pressable
                onPress={appInstall.cerrarVeredicto}
                accessibilityRole="button"
                accessibilityLabel="Cerrar"
                hitSlop={8}
                style={styles.cerrar}>
                <Ionicons name="close" size={18} color={Palette.textSecondary} />
              </Pressable>
            )}
          </View>
          <Text style={styles.texto}>
            {appInstall.installing
              ? 'Tarda unos segundos. El icono aparecerá en tu pantalla de inicio y la app se abrirá sin barra del navegador.'
              : // "No ha llegado la confirmación", no "no está instalada": si el evento
                // llega más tarde, la tarjeta se corrige sola y avisa. Afirmar que no
                // está instalada sería mentira en ese caso.
                'No hemos recibido la confirmación del navegador. Búscala en el cajón de aplicaciones, no solo en la primera pantalla: si no está, la instalación a mano suele estar en el menú del navegador, y en Ajustes están los pasos.'}
          </Text>
        </View>
      </View>
    );
  }

  // El final bueno también se dice. Sin esto, instalar bien terminaba en silencio:
  // el aviso se retiraba, el icono aparecía y no había ninguna confirmación de que
  // aquello era el fin del proceso y no otro cuelgue.
  if (appInstall.veredicto === 'confirmada') {
    return (
      <View style={styles.contenedor} accessibilityRole="alert">
        <View style={styles.tarjeta}>
          <View style={styles.cabecera}>
            <Ionicons name="checkmark-circle-outline" size={20} color={Palette.accent} />
            <Text style={styles.titulo}>MiCasa ya está instalada</Text>
            <Pressable
              onPress={appInstall.cerrarVeredicto}
              accessibilityRole="button"
              accessibilityLabel="Cerrar"
              hitSlop={8}
              style={styles.cerrar}>
              <Ionicons name="close" size={18} color={Palette.textSecondary} />
            </Pressable>
          </View>
          <Text style={styles.texto}>
            Ya tienes MiCasa con su propio icono. Se abre sin barra del navegador y los avisos llegan aunque la
            cierres.
          </Text>
        </View>
      </View>
    );
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
