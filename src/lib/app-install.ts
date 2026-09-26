/**
 * Instalación de la web como app.
 *
 * La web es una PWA instalable, pero el navegador no avisa de nada: en Android
 * y escritorio aparece un banner que se puede ignorar, en iPhone no aparece
 * nada y hay que compartir y añadir a pantalla de inicio a mano, y en Firefox no
 * se instala de ninguna manera. Sin esto, la única forma de instalarla era
 * saber que existía el menú del navegador.
 *
 * Aquí solo hay lógica pura: recibe lo que se ha medido del entorno y devuelve
 * qué hay que contarle a la persona. Ni `window`, ni `navigator`, ni eventos.
 * Lo que habla con el navegador vive en `src/hooks/use-app-install.ts`.
 */

/** Dónde se ha abierto. Cambia los pasos, no el resultado. */
export type InstallPlatform = 'ios' | 'android' | 'desktop' | 'otro';

/**
 * Qué se puede hacer ahora mismo desde la app.
 *
 * - `instalada`: ya se está ejecutando como app. No hay nada que ofrecer.
 * - `instalable`: el navegador ha dicho que puede instalarla y hay un boton que
 *   lo hace el mismo. Es el unico caso en el que se puede instalar con un toque.
 * - `manual`: se puede instalar, pero el navegador no da el evento. Pasa en
 *   iPhone y en Firefox, y ahi los pasos los tiene que hacer la persona.
 * - `no-instalable`: este navegador no la instalara nunca. Decirlo es mejor que
 *   mostrar unos pasos que no funcionan.
 */
export type InstallState = 'instalada' | 'instalable' | 'manual' | 'no-instalable';

export interface InstallView {
  /** Si la tarjeta se enseña. En nativo no hay nada que instalar. */
  visible: boolean;
  title: string;
  /** Una frase con la situacion actual. */
  body: string;
  /** Los pasos, en orden. Vacio cuando no hay que hacer nada. */
  steps: string[];
  /**
   * Los pasos siempre, aunque no se enseñen.
   *
   * En `instalable` la tarjeta enseña el botón y no los pasos, porque hay un
   * camino de un toque. Pero si la persona lo rechaza, o si el navegador se
   * gasta el evento, el aviso tiene que poder decir cómo se hace a mano, y para
   * eso hacen falta aunque no se estén pintando.
   */
  manualSteps: string[];
  /** Texto del boton. `null` cuando no hay boton que pulsar. */
  action: string | null;
  /** Un boton con un toque solo cuando el navegador lo permite. */
  actionIsPrompt: boolean;
  /** El paso mas importante, para el que solo lee el titulo. */
  highlight: string | null;
}

/**
 * Detecta la plataforma por el usuario y los puntos de contacto.
 *
 * Se separa del resto porque es lo único que lee de fuera: todo lo demás
 * depende de la plataforma ya detectada y se prueba sin DOM.
 *
 * Lo que separa un iPad de un Mac no es el usuario: desde iPadOS 13 el iPad se
 * anuncia con la misma cadena que un Mac, byte a byte. Mirar el proveedor no
 * sirve tampoco, porque Safari dice lo mismo en los dos. Lo único que los
 * distingue son los puntos de contacto, que en un iPad son varios y en un Mac
 * con trackpad son cero o uno.
 *
 * Sin esto pasaban dos cosas malas a la vez: un Mac con Safari recibía los pasos
 * de iPhone, y un iPad con Chrome o Firefox caía en escritorio y se le decía que
 * su navegador no puede instalar cuando desde iOS 16.4 cualquier navegador
 * puede añadirla a la pantalla de inicio.
 */
export function detectPlatform(
  userAgent: string,
  maxTouchPoints = 0,
): InstallPlatform {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  if (/Macintosh/i.test(userAgent)) return maxTouchPoints > 1 ? 'ios' : 'desktop';
  if (/Android/i.test(userAgent)) return 'android';
  if (/Windows|CrOS|Linux/i.test(userAgent)) return 'desktop';
  return 'otro';
}

/**
 * Que estado corresponde a lo que se ha medido.
 *
 * El navegador solo da el evento cuando puede instalarla de verdad, asi que
 * `instalable` no se deduce: se espera. Por eso la comprobacion de "ya
 * instalada" va antes que ninguna otra.
 */
export function resolveState(input: {
  platform: InstallPlatform;
  native: boolean;
  standalone: boolean;
  /** El evento `beforeinstallprompt` llego. */
  promptAvailable: boolean;
}): InstallState {
  if (input.native) return 'instalada';
  if (input.standalone) return 'instalada';
  if (input.promptAvailable) return 'instalable';
  if (input.platform === 'ios' || input.platform === 'otro') return 'manual';
  return 'no-instalable';
}

const STEPS: Record<InstallPlatform, string[]> = {
  ios: [
    'Abre el menú Compartir, el cuadrado con la flecha hacia arriba.',
    'Abajo, "Añadir a pantalla de inicio".',
    'Confirma con "Añadir". La app se abre con su propio icono, sin barra del navegador.',
  ],
  android: [
    'Abre el menú del navegador, los tres puntos de arriba a la derecha.',
    'Toca "Instalar app" o "Añadir a pantalla de inicio".',
    'Confirma. La app se abre con su propio icono, sin barra del navegador.',
  ],
  desktop: [
    'Abre el menú del navegador, arriba a la derecha.',
    'Toca "Instalar MiCasa" o "Crear acceso directo".',
    'La app se abre en su propia ventana, sin barra de direcciones.',
  ],
  otro: [
    'En el menú del navegador, busca la opción de instalar o de añadir a la pantalla de inicio.',
    'Si no aparece, este navegador no puede instalarla: usa el icono de favoritos como acceso directo.',
  ],
};
/**
 * Que se le enseña a la persona, según el estado.
 *
 * El texto va en función de lo que la persona va a encontrar en su navegador,
 * no de lo que se ha medido por dentro: quien tiene iOS lee "Compartir" y no
 * "instalar", porque el botón que ofrece el sistema se llama así.
 */
export function installView(state: InstallState, platform: InstallPlatform): InstallView {
  if (state === 'instalada') {
    return {
      visible: true,
      title: 'App instalada',
      body: 'Ya tienes MiCasa en este dispositivo, con su propio icono.',
      steps: [],
      manualSteps: [],
      action: null,
      actionIsPrompt: false,
      highlight: null,
    };
  }

  if (state === 'instalable') {
    return {
      visible: true,
      title: 'Instala la app',
      body: 'MiCasa se puede instalar como app: se abre con su propio icono y sin barra del navegador, y los avisos de citas y cumpleaños funcionan mejor.',
      steps: [],
      manualSteps: STEPS[platform],
      action: 'Instalar ahora',
      actionIsPrompt: true,
      highlight: null,
    };
  }

  if (state === 'no-instalable') {
    return {
      visible: true,
      title: 'Esta web ya es la app',
      body: 'Este navegador no puede instalarla, pero no la necesitas: MiCasa funciona igual abierta aquí. Guárdala en favoritos para abrirla en un toque.',
      steps: [],
      manualSteps: [],
      action: null,
      actionIsPrompt: false,
      highlight: null,
    };
  }

  // El respaldo no es alcanzable desde TypeScript: `STEPS` está indexada por
  // `InstallPlatform`, así que añadir una plataforma sin sus pasos no compila.
  // Se queda por si algo llega aquí desde JavaScript sin tipos, donde
  // `pasos[0]` sí reventaría en el render y tumbaría Ajustes entera.
  const pasos = STEPS[platform] ?? STEPS.otro;
  const sharesIos = platform === 'ios';
  return {
    visible: true,
    title: 'Instala la app',
    body: sharesIos
      ? 'En iPhone la app se añade desde el menú Compartir. Tarda diez segundos y a partir de ahí se abre con su propio icono.'
      : 'MiCasa se puede instalar como app: se abre con su propio icono y sin barra del navegador.',
    steps: pasos,
    manualSteps: pasos,
    action: null,
    actionIsPrompt: false,
    highlight: pasos[0],
  };
}

/**
 * Si en este navegador los avisos push necesitan la app instalada.
 *
 * En iPhone el Web Push solo funciona en la app de la pantalla de inicio, y no
 * en una pestaña normal. Es la razon por la que se pide instalar.
 */
export function pushNeedsInstalledApp(input: {
  platform: InstallPlatform;
  standalone: boolean;
  /** El navegador tiene las tres APIs que hacen falta para enviar. */
  pushSupported: boolean;
}): boolean {
  if (!input.pushSupported) return false;
  return input.platform === 'ios' && !input.standalone;
}

/** El aviso que se le enseña a quien tiene los avisos pushed en el iPhone. */
export function pushNeedingInstallNotice(): { title: string; body: string } {
  return {
    title: 'Añádela a la pantalla de inicio',
    body: 'En iPhone, los avisos de citas y cumpleaños solo llegan si MiCasa está añadida a la pantalla de inicio. Búscala en el menú Compartir, con el cuadrado y la flecha hacia arriba.',
  };
}
