import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { detectPlatform, installView, pushNeedsInstalledApp, pushNeedingInstallNotice, resolveState, type InstallPlatform, type InstallView } from '@/lib/app-install';
import { canListen, consume, read, subscribe, type InstallPromptEvent } from '@/lib/install-prompt';

/** Cuánto se espera el evento `appinstalled` antes de dejar de prometer nada. */
export const INSTALL_CONFIRM_MS = 4000;

const NO_PREGUNTAR_MAS = 'micasa.no_preguntar_instalar';

/** Que la persona ya ha dicho que no quiere que se le pregunte. */
export type PromptDecision = 'si' | 'no' | 'no-preguntar-mas' | 'todavia-no';

export interface AppInstall {
  view: InstallView;
  platform: InstallPlatform;
  /** `true` solo en la app ya instalada, o en nativo donde no hay nada que hacer. */
  standalone: boolean;
  /**
   * Estado de la instalación en curso.
   *
   * Aceptar el diálogo del navegador NO es instalar: la instalación sigue en
   * marcha y puede fallar. Por eso esto va aparte de `standalone`, que solo lo
   * pone el evento `appinstalled`. Antes de este campo, `install()` ponía
   * `standalone` en cuanto la persona aceptaba, y la tarjeta decía "App instalada"
   * sin que hubiera icono.
   *
   * Se limpia sola si el evento `appinstalled` no llega en `INSTALL_CONFIRM_MS`.
   * Antes había un segundo flag para el temporizador, y siempre valían lo mismo:
   * dos nombres para un estado.
   */
  installing: boolean;
  /** Lanza la instalación. `false` cuando el navegador no dio el evento. */
  install: () => Promise<PromptDecision>;
  /** Se llama al rechazar el aviso-emergente, para recordarlo o no. */
  decideAskAgain: (decision: Exclude<PromptDecision, 'todavia-no'>) => void;
  /**
   * Si el aviso-emergente debe verse ahora: hay evento, no está instalada, no
   * está en curso y la persona no ha dicho que no pregunte más.
   */
  shouldAsk: boolean;
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
 * - Distingue "aceptó el diálogo" de "instalada": solo el evento `appinstalled`
 *   dice lo segundo.
 * - Recuerda si la persona pidió que no le volvieran a preguntar.
 * - Avisa cuando los avisos push necesitan la app, que en iPhone es siempre.
 */
export function useAppInstall(): AppInstall {
  const native = Platform.OS !== 'web';

  // Lo que se puede leer sin esperar se lee al inicializar el estado, no en un
  // efecto. Con setState en un efecto, la primera pintada va con "otro" y sin
  // evento, y luego salta a lo real: en Ajustes se ve ese parpadeo, y en iPhone
  // aparecería un texto equivocado durante un frame.
  //
  // El evento se lee con `useSyncExternalStore` y no con `useState` porque es un
  // almacén externo: con estado, el valor se leería una vez al montar y el evento
  // firmado entre el render y el efecto se perdería. En nativo no hay ni evento
  // ni suscripción.
  const promptEvent = usePromptEvent(native);
  const [standalone, setStandalone] = useState(() => (native ? false : readStandalone()));
  const [installing, setInstalling] = useState(false);
  // Dos cosas distintas y que se confundían: lo descartado en esta sesión, que
  // hace callar al aviso ya, y la preferencia guardada, que hace callo para
  // siempre. Con una sola, "Ahora no" no tapaba el aviso: se leía, se contestaba
  // que no, y el aviso seguía ahí.
  const [descartadoEnEstaSesion, setDescartadoEnEstaSesion] = useState(false);
  const [prefGuardada, setPrefGuardada] = useState(false);
  const [platform] = useState<InstallPlatform>(() => (native ? 'otro' : readPlatform()));
  const pushSupported = native ? false : readPushSupported();

  // La preferencia se lee una vez al montar. Se lee después a propósito para que
  // el aviso-emergente no aparezca en el primer frame aunque la persona lo haya
  // dicho antes: un aviso que aparece y desaparece es peor que uno que no sale.
  useEffect(() => {
    if (native) return;
    let vigente = true;
    void AsyncStorage.getItem(NO_PREGUNTAR_MAS)
      .then((valor) => {
        if (vigente && valor === '1') setPrefGuardada(true);
      })
      .catch(() => {
        // Sin almacenamiento no se recuerda, pero la app sigue funcionando: solo
        // se volvería a preguntar en esta sesión.
      });
    return () => {
      vigente = false;
    };
  }, [native]);

  useEffect(() => {
    // La capacidad se comprueba antes de tocar `window` para nada: antes se
    // llamaba a `matchMedia` y luego se comprobaba, y en un `Platform.OS` de web
    // sin `window` declarado eso es un ReferenceError dentro del efecto.
    if (native || !canListen()) return;

    const onInstalled = () => {
      consume();
      // Aquí sí: el navegador ha instalado de verdad. También se guarda que no
      // vuelva a preguntar, porque ya no tiene sentido.
      setStandalone(true);
      setInstalling(false);
      setDescartadoEnEstaSesion(true);
      setPrefGuardada(true);
      void AsyncStorage.setItem(NO_PREGUNTAR_MAS, '1').catch(() => undefined);
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

  // Si se aceptó y el evento no llega en un rato, se deja de estar en "instalando"
  // sin decir que está instalada. Puede que el navegador la haya instalado y no
  // lo diga, o que haya fallado; en los dos casos la tarjeta sigue siendo la que
  // dice la verdad.
  useEffect(() => {
    if (!installing) return;
    const temporizador = setTimeout(() => setInstalling(false), INSTALL_CONFIRM_MS);
    return () => clearTimeout(temporizador);
  }, [installing]);

  const install = useCallback(async (): Promise<PromptDecision> => {
    if (!promptEvent) return 'todavia-no';
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      const accepted = choice.outcome === 'accepted';
      // El evento se agota: si la persona no acepta, hay que esperar a que el
      // navegador lance otro, y el botón no puede ofrecerlo otra vez. El almacén se
      // vacía también, o un componente que se monte después volvería a encontrar
      // un evento gastado.
      consume();
      if (accepted) {
        // No se marca como instalada: solo se espera a `appinstalled`.
        setInstalling(true);
      }
      return accepted ? 'si' : 'no';
    } catch {
      // Un `prompt()` que lanza significa que el navegador ya no lo permite. No
      // es un fallo que la persona pueda resolver, asi que se avisa y a seguir.
      consume();
      return 'no';
    }
  }, [promptEvent]);

  const decideAskAgain = useCallback((decision: Exclude<PromptDecision, 'todavia-no'>) => {
    // Las dos decisiones callan el aviso ya. Lo que las separa es si se
    // recuerda: un "ahora no" en un mal dia no puede ser silencioso para siempre.
    setDescartadoEnEstaSesion(true);
    if (decision === 'no-preguntar-mas') {
      setPrefGuardada(true);
      void AsyncStorage.setItem(NO_PREGUNTAR_MAS, '1').catch(() => undefined);
      return;
    }
    setPrefGuardada(false);
    void AsyncStorage.removeItem(NO_PREGUNTAR_MAS).catch(() => undefined);
  }, []);

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
    installing,
    install,
    decideAskAgain,
    shouldAsk:
      !native &&
      promptEvent !== null &&
      !standalone &&
      !installing &&
      !descartadoEnEstaSesion &&
      !prefGuardada,
    pushNotice: pushNeedsInstalledApp({ platform, standalone, pushSupported })
      ? pushNeedingInstallNotice()
      : null,
  };
}

/**
 * El almacén del evento. En nativo no hay ni evento ni suscripción, y por eso las
 * tres funciones van vacías: enganchar en nativo dejaría la app pidiendo instalar
 * algo que no existe.
 */
function usePromptEvent(native: boolean): InstallPromptEvent | null {
  return useSyncExternalStore(
    native ? SIN_SUSCRIPCION : subscribe,
    native ? SIN_EVENTO : read,
    SIN_EVENTO,
  );
}
