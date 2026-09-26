import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { detectPlatform, installView, pushNeedsInstalledApp, pushNeedingInstallNotice, resolveState, type InstallPlatform, type InstallView } from '@/lib/app-install';
import { canListen, consume, read, subscribe, type InstallPromptEvent } from '@/lib/install-prompt';

export interface AppInstall {
  view: InstallView;
  platform: InstallPlatform;
  /** `true` solo en la app ya instalada, o en nativo donde no hay nada que hacer. */
  standalone: boolean;
  /** Lanza la instalación. `false` cuando el navegador no dio el evento. */
  install: () => Promise<boolean>;
  /**
   * Aviso para cuando los avisos push necesitan la app instalada, que en iPhone
   * es el caso. `null` cuando no aplica.
   */
  pushNotice: { title: string; body: string } | null;
}

const SIN_EVENTO = (): null => null;
const SIN_SUSCRIPCION = (): (() => void) => () => undefined;

function readStandalone(): boolean {
  // Se comprueban los dos por separado y no solo `window`: hay entornos donde
  // existe `window` y no `navigator`, y sin esta guarda el hook revienta la
  // pantalla entera al montar. Es lo que pasa en el entorno de pruebas de React
  // Native, y podría pasar en un webview embebido.
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  // `display-mode: standalone` cubre Chrome, Edge y lo que se instala desde el
  // menú. `navigator.standalone` es la forma antigua de Safari en iPhone, y es
  // la unica que funciona en la app de la pantalla de inicio de iOS.
  const porDisplayMode =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  const legacy = (navigator as { standalone?: boolean }).standalone === true;
  return porDisplayMode || legacy;
}

function readPlatform(): InstallPlatform {
  if (typeof navigator === 'undefined') return 'otro';
  return detectPlatform(navigator.userAgent ?? '', (navigator as { maxTouchPoints?: number }).maxTouchPoints);
}

/** Las tres APIs que hacen falta para poder enviar avisos desde el navegador. */
function readPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Estado de la instalación de la web, y el botón para instalarla.
 *
 * Lo que hace:
 * - Toma `beforeinstallprompt` del almacén de `install-prompt`, que lo escucha
 *   desde el arranque de la app y no desde aquí, para que no se pierda si el
 *   evento salió antes de que esta pantalla existiera. En iPhone no existe, y
 *   por ahí el botón no aparece y se enseñan los pasos a mano.
 * - Mira si ya se está ejecutando instalada, para no ofrecer instalar dos veces.
 * - Avisa cuando los avisos push necesitan la app, que en iPhone es siempre.
 */
export function useAppInstall(): AppInstall {
  const native = Platform.OS !== 'web';

  // Lo que se puede leer sin esperar se lee al inicializar el estado, no en un
  // efecto. Con setState en un efecto, la primera pintada de la tarjeta va con
  // "otro" y sin evento, y luego salta a lo real: en Ajustes se ve ese parpadeo,
  // y en iPhone aparecería un texto equivocado durante un frame.
  //
  // Tampoco se pregunta por el soporte de push en un efecto aparte: eso no cambia
  // en toda la vida de la pestaña, así que solo genera un render de más. Y así
  // este módulo no depende de `web-push`, que trae Supabase y el registro del
  // worker, y se puede probar sin levantar nada.
  //
  // El evento se lee con `useSyncExternalStore` y no con `useState` porque es un
  // almacén externo: con estado, el valor se leería una vez al montar y el evento
  // firmado entre el render y el efecto se perdería, que es justo lo que este
  // bloque viene a arreglar. En nativo no hay ni evento ni suscripción.
  const promptEvent: InstallPromptEvent | null = useSyncExternalStore(
    native ? SIN_SUSCRIPCION : subscribe,
    native ? SIN_EVENTO : read,
    SIN_EVENTO,
  );
  const [standalone, setStandalone] = useState(() => (native ? false : readStandalone()));
  const [platform] = useState<InstallPlatform>(() => (native ? 'otro' : readPlatform()));
  const pushSupported = native ? false : readPushSupported();

  useEffect(() => {
    // La capacidad se comprueba antes de tocar `window` para nada: antes se
    // llamaba a `matchMedia` y luego se comprobaba, y en un `Platform.OS` de web
    // sin `window` declarado eso es un ReferenceError dentro del efecto.
    if (native || !canListen()) return;

    const onInstalled = () => {
      consume();
      setStandalone(true);
    };

    // La app puede pasar a instalada desde el menú del navegador sin pasar por
    // el botón, y volver a una pestaña normal al cerrarla.
    const query =
      typeof window.matchMedia === 'function' ? window.matchMedia('(display-mode: standalone)') : null;
    const onDisplayModeChange = () => setStandalone(readStandalone());
    query?.addEventListener?.('change', onDisplayModeChange);

    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('appinstalled', onInstalled);
      query?.removeEventListener?.('change', onDisplayModeChange);
    };
  }, [native]);

  const install = useCallback(async (): Promise<boolean> => {
    if (!promptEvent) return false;
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      const accepted = choice.outcome === 'accepted';
      // El evento se agota: si la persona no acepta, hay que esperar a que el
      // navegador lance otro, y el botón no puede ofrecerlo otra vez. El almacén se
      // vacía también, o un componente que se monte después volvería a encontrar
      // un evento gastado.
      consume();
      if (accepted) setStandalone(true);
      return accepted;
    } catch {
      // Un `prompt()` que lanza significa que el navegador ya no lo permite. No
      // es un fallo que la persona pueda resolver, asi que se avisa y a seguir.
      consume();
      return false;
    }
  }, [promptEvent]);

  const state = resolveState({
    platform,
    native,
    standalone,
    promptAvailable: promptEvent !== null,
  });
  const view = installView(state, platform);

  return {
    view: { ...view, visible: !native && view.visible },
    platform,
    standalone,
    install,
    pushNotice: pushNeedsInstalledApp({ platform, standalone, pushSupported })
      ? pushNeedingInstallNotice()
      : null,
  };
}
