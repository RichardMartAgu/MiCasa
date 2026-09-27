import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { detectPlatform, installView, pushNeedsInstalledApp, pushNeedingInstallNotice, resolveState, type InstallPlatform, type InstallView } from '@/lib/app-install';
import {
  canListen,
  consume,
  read,
  readVeredicto,
  setVeredicto,
  subscribe,
  type InstallPromptEvent,
  type VeredictoInstall,
} from '@/lib/install-prompt';

/**
 * Cuánto se espera el evento `appinstalled` antes de dejar de prometer nada.
 *
 * Cuatro segundos era una suposición sin medir, y era corta: en un móvil de verdad
 * instalar no es un cambio de estado. Diez segundos es una heurística, no
 * un dato, y por eso el veredicto que se da al vencer no es "no se ha
 * instalado" sino "no hemos podido confirmarlo": si el evento llega más tarde,
 * la pantalla se corrige sola y dice que sí está instalada.
 */
export const INSTALL_CONFIRM_MS = 10000;

const NO_PREGUNTAR_MAS = 'micasa.no_preguntar_instalar';

export type PromptDecision =
  /** Se aceptó el diálogo del navegador: la instalación está en marcha. */
  | 'si'
  /** Se pulsó "Ahora no" en el aviso. */
  | 'no'
  /** "No preguntar más" en el aviso. */
  | 'no-preguntar-mas'
  /** No hay evento del navegador: no se puede instalar con un toque. */
  | 'todavia-no'
  /** El navegador enseñó su diálogo y la persona lo cerró sin aceptar. */
  | 'cerrada'
  /** El navegador ya no permite el diálogo (se ha gastado o no lo admite). */
  | 'no-permitido';

/**
 * Cómo terminó el intento de instalar.
 *
 * Antes solo había "instalando" y "instalada", y ningún camino intermedio existía: ni
 * el fallo, ni el diálogo cerrado. Todo lo que no acababa en `appinstalled`
 * terminaba callado, y por eso se podía reintentar para siempre sin que nadie
 * supiera qué había pasado.
 */
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
  /** Cómo terminó el último intento. Se queda hasta que se cierre o se reintente. */
  veredicto: VeredictoInstall;
  /** Cierra el veredicto para que deje de ocupar sitio. */
  cerrarVeredicto: () => void;
  /** Lanza la instalación. Dice qué pasó, no solo si se aceptó el diálogo. */
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
  // El veredicto de la instalación en curso. Sin esto, aceptar el diálogo de
  // Chrome acababa en silencio: se dejaba de estar "instalando" y no se pintaba
  // nada, así que la persona se quedaba sin saber si había funcionado y podía
  // pulsar el botón otra vez indefinidamente.
  //
  // Vive en el almacén de módulo y no en este `useState` porque el hook se monta
  // dos veces (layout de pestañas y Ajustes) y, con estado local, el aviso y la
  // tarjeta no veían el mismo intento: el proceso se escondía en la pantalla
  // desde la que no se había lanzado.
  // Sin suscripción en nativo: `subscribe` engancha el listener del navegador, y
  // en nativo no se toca. Es la misma razón por la que el evento se lee con una
  // suscripción falsa allí.
  const veredicto: VeredictoInstall = useSyncExternalStore(
    native ? SIN_SUSCRIPCION : subscribe,
    readVeredicto,
    () => 'ninguno',
  );
  const installing = veredicto === 'esperando';
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
      // El cartel de "ya está instalada" solo si había un intento en marcha desde
      // la app. Si la persona la instaló desde el menú del navegador sin tocar
      // nuestro botón, un `alert` asertivo en mitad de lo que ya estaba haciendo
      // es una interrumpición que no ha pedido nadie. La tarjeta de Ajustes lo
      // refleja igualmente por `standalone`.
      if (readVeredicto() === 'esperando' || readVeredicto() === 'sin-confirmar') {
        setVeredicto('confirmada');
      }
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

  // Si se aceptó y el evento no llega, se deja de estar en "instalando" sin decir
  // que está instalada: puede que el navegador la haya instalado y no lo diga, o
  // que haya fallado. Lo que no puede ser es no decir nada, así que el estado
  // que queda es un veredicto explícito que la pantalla pinta y que se puede
  // cerrar, en vez de un silencio que se lee como un fallo.
  useEffect(() => {
    if (veredicto !== 'esperando') return;
    const temporizador = setTimeout(() => setVeredicto('sin-confirmar'), INSTALL_CONFIRM_MS);
    return () => clearTimeout(temporizador);
  }, [veredicto]);

  const install = useCallback(async (): Promise<PromptDecision> => {
    if (!promptEvent) return 'todavia-no';
    // El banner y la tarjeta de Ajustes están los dos en pantalla, así que un
    // doble toque es fácil. La segunda llamada a `prompt()` lanzaría, y además
    // borraría el estado del intento que sí está en marcha: quien está
    // instalando se quedaría sin nada que explique su proceso.
    // Se lee del almacén y no del valor del closure: dos clics en el mismo
    // fotograma no llegan a re-pintar, así que el closure todavía diría "ninguno"
    // en el segundo y dejaría pasar los dos `prompt()`.
    if (readVeredicto() === 'esperando') return 'si';
    setVeredicto('ninguno');

    try {
      await promptEvent.prompt();
    } catch (error) {
      // `prompt()` rechaza con `AbortError` cuando la persona cierra el diálogo
      // nativo: el diálogo sí se enseñó, así que no es que el navegador no lo
      // permita. Era lo que se.Before decía "no permitido" y llevaba a la gente
      // a tocar unos ajustes que no eran el problema.
      consume();
      return error instanceof Error && error.name === 'AbortError' ? 'cerrada' : 'no-permitido';
    }

    // A partir de aquí el diálogo se ha enseñado. El veredicto se pone ANTES de
    // esperar `userChoice`: si esa promesa rechaza, la instalación puede estar en
    // marcha y lo que no puede ser es quedarse sin nada que la explique, que es
    // justo el silencio que este bloque vino a cerrar.
    setVeredicto('esperando');

    let accepted = false;
    try {
      accepted = (await promptEvent.userChoice).outcome === 'accepted';
    } catch {
      // No se puede saber si se aceptó. Se deja el veredicto en 'esperando' y
      // que el evento `appinstalled` lo confirme: afirmar lo contrario sería
      // inventar.
      return 'si';
    }

    consume();
    if (!accepted) {
      setVeredicto('ninguno');
      return 'cerrada';
    }
    return 'si';
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

  // Cerrar el veredicto no puede cancelar una instalación en marcha. Se podrá
  // cerrar cuando ya haya terminado de bien o de mal, pero no mientras sigue:
  // hacerlo borraba el temporizador que iba a decir "no hemos podido confirmar",
  // y con el evento ya gastado no quedaba nada en pantalla. El resultado era que
  // tocar el cartel mientras instalaba lo hacía desaparecer, que es justo lo que
  // se vio en un Android real.
  const cerrarVeredicto = useCallback(() => {
    if (readVeredicto() === 'esperando') return;
    setVeredicto('ninguno');
  }, []);

  return {
    view: { ...view, visible: !native && view.visible },
    platform,
    standalone,
    installing,
    veredicto,
    cerrarVeredicto,
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
