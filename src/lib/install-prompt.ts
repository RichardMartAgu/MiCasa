/**
 * El evento de instalación de la PWA, como almacén externo.
 *
 * Existe como módulo aparte, y no dentro del hook, por un motivo concreto:
 * Chromium lanza `beforeinstallprompt` **una vez por carga** y no lo repite. Si
 * el listener se enganchara al montar la pantalla que lo usa, el evento se
 * firmaría antes de que esa pantalla exista y se perdería para siempre. Pasaría
 * siempre en la práctica, porque Ajustes es una pestaña y a ella se llega tras el
 * splash, el login y elegir casa, mientras que el evento sale en cuanto la web
 * cumple los requisitos, normalmente nada más cargar.
 *
 * Lo que se pierde no es el banner del navegador, que también puede aparecer: es
 * el botón de instalar de la app. Y sin el botón, la tarjeta acabaría diciendo
 * "este navegador no puede instalarla" en un Chrome que sí puede, que es
 * mentira justo en el caso más común.
 *
 * Por eso el listener se engancha **al importar este módulo**, y este módulo se
 * importa desde el layout raíz de la app, que Expo Router evalúa al arrancar y no
 * bajo demanda como las rutas. Importarlo desde el hook también vale, pero llega
 * tarde; por eso el layout raíz lo importa también, y con un comentario que
 * explica que no se mueva.
 */

export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let cached: InstallPromptEvent | null = null;
let attached = false;
const subscribers = new Set<() => void>();

/** Si este entorno admite escuchar eventos de `window`. */
export function canListen(): boolean {
  return typeof window !== 'undefined' && typeof window.addEventListener === 'function';
}

export function attach(): void {
  if (attached || !canListen()) return;
  attached = true;
  window.addEventListener('beforeinstallprompt', (event) => {
    // Sin esto Chromium enseña su banner por su cuenta y consume el único uso
    // del evento. También con el banner abierto, `prompt()` deja de funcionar.
    event.preventDefault();
    set(event as InstallPromptEvent);
  });
}

function set(event: InstallPromptEvent | null): void {
  if (cached === event) return;
  cached = event;
  for (const subscriber of subscribers) subscriber();
}

/** Se suscribe a los cambios. Devuelve la función para soltarse. */
export function subscribe(onChange: () => void): () => void {
  attach();
  subscribers.add(onChange);
  return () => {
    subscribers.delete(onChange);
  };
}

/** El evento guardado, o `null` si no hay ninguno o ya se gastó. */
export function read(): InstallPromptEvent | null {
  return cached;
}

/** Vacía el evento. Se usa cuando ya se ha empezado a instalar. */
export function consume(): void {
  set(null);
}

// Se engancha al importar. En nativo y en los entornos de prueba `canListen()` es
// falso y no pasa nada.
attach();

/**
 * Deja el almacén como recién importado.
 *
 * Solo para tests: en producción el evento se agota solo, y por eso esta función
 * no existe en el bundle de la app. Va aquí y no en el test porque el estado es
 * de módulo, y sin poder ponerlo a cero un test que deje un evento guardado
 * haría pasar a los siguientes por lo mismo.
 */
export function resetForTests(): void {
  cached = null;
  attached = false;
  subscribers.clear();
}

/** Cuántos componentes están escuchando. Solo para tests: una fuga no se ve. */
export function subscriberCountForTests(): number {
  return subscribers.size;
}
