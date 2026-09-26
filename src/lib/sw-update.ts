/**
 * Si hay una versión nueva esperando, y la forma de aplicarla sin recargar a
 * nadie por sorpresa.
 *
 * Existe por un motivo medido, no teórico: el service worker servía la navegación
 * desde su precache y **nunca** podía activarse, porque sin `skipWaiting()`
 * espera a que se cierren todos sus clientes. Con la app instalada siempre hay un
 * cliente vivo, así que el usuario se quedaba con el bundle de su primer
 * despliegue, indefinidamente y sin aviso. Eso invalidaba sus pruebas una y otra
 * vez: reporting bugs de código que ya no estaba en producción.
 *
 * El agravante es que el atasco era invisible. El shell viejo pedía bundles que
 * el despliegue anterior ya había borrado, y Vercel respondía `200 text/html` con
 * el `index.html` en lugar de un 404, así que el navegador recibía HTML donde
 * esperaba JavaScript y, con `nosniff`, se negaba a ejecutarlo sin decir nada.
 *
 * Aquí está el orden, y es importante que sea este:
 *
 * 1. El service worker nuevo se queda **esperando**. Nadie lo activa solo.
 * 2. Si lo hay esperando, la app lo dice y ofrece recargar.
 * 3. Quien pulsa "Recargar" manda el mensaje que activa el worker.
 * 4. La recarga ocurre en `controllerchange`, que es cuando el control ya cambió.
 *
 * El paso 1 es el que parece un的一名 rodeo y no lo es. Si se activara el worker
 * al instalarse, `controllerchange` se dispararía acto seguido, el aviso
 * desaparecería sin que nadie lo pulsara y la página se quedaría con el código
 * viejo bajo un worker nuevo. Recargar solo puede además perder un formulario a
 * medio rellenar, así que la decisión es de la persona.
 *
 * Es un almacén de módulo, y no estado de un componente, porque el enganche tiene
 * que estar en el layout raíz: si viviera en una pantalla, no existiría en login
 * ni en registro, que es justo donde se entra después de un despliegue.
 */

import { showNotice } from '@/lib/notice';

const CLAVE_INTENCION = 'micasa:reload-pendiente';
const CLAVE_DESCARTE = 'micasa:version-descartada';
const CLAVE_DESCARTE_URL = 'micasa:version-descartada-worker';
/** Si tras pedir la recarga no cambia el control, hay que decirlo. */
const MS_SIN_RESPUESTA = 3000;

let pendiente = false;
const suscriptores = new Set<() => void>();

function avisar() {
  for (const s of suscriptores) s();
}

function setPendiente(valor: boolean) {
  if (pendiente === valor) return;
  pendiente = valor;
  avisar();
}

export function suscribir(onChange: () => void): () => void {
  suscriptores.add(onChange);
  return () => {
    suscriptores.delete(onChange);
  };
}

export function leerPendiente(): boolean {
  return pendiente;
}

/** Si la persona ya ha pedido recargar, aunque el control aún no haya cambiado. */
export function hayRecargaPedida(): boolean {
  return leerSenal(CLAVE_INTENCION);
}

/**
 * Si esta sesión ya dijo "más tarde" **para esta misma versión**.
 *
 * Se guarda qué worker se descartó, no solo que se descartó: `sessionStorage`
 * sobrevive a las recargas, así que una marca suelta silenciaría los avisos de
 * todas las versiones siguientes en esa pestaña, que no es lo que se pidió. Con un
 * despliegue nuevo, la marca ya no coincide y el aviso vuelve a salir.
 */
function descartadaPara(scriptUrl: string | null): boolean {
  if (!leerSenal(CLAVE_DESCARTE)) return false;
  const guardado = leerTexto(CLAVE_DESCARTE_URL);
  return guardado === (scriptUrl ?? null);
}

function leerTexto(clave: string): string | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(clave);
  } catch {
    return null;
  }
}

function leerSenal(clave: string): boolean {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(clave) === '1';
  } catch {
    // Modo privado restrictivo: sin memoria, pero sin romperse.
    return false;
  }
}

function escribirSenal(clave: string, valor: boolean | string | null) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (valor === false || valor === null) sessionStorage.removeItem(clave);
    else sessionStorage.setItem(clave, valor === true ? '1' : valor);
  } catch {
    // Sin señal persistente no se rompe nada: el flujo sigue funcionando con lo
    // que hay en memoria.
  }
}

export function descartarVersion(): void {
  void leerWorker().then((url) => {
    escribirSenal(CLAVE_DESCARTE, true);
    escribirSenal(CLAVE_DESCARTE_URL, url);
    setPendiente(false);
  });
}

function leerWorker(): Promise<string | null> {
  return navigator.serviceWorker
    .getRegistration()
    .then((registration) => registration?.waiting?.scriptURL ?? null)
    .catch(() => null);
}

/**
 * Pide activar la versión nueva y recargar.
 *
 * Marca la intención antes de pedirla, porque el `controllerchange` puede llegar
 * de otra pestaña y hay que reconocerlo como respuesta a esto y no como un
 * cambio de la otra.
 */
export function aplicarActualizacion(): void {
  // La marca se pone antes de pedir nada, y se borra en cuanto el control cambia.
  escribirSenal(CLAVE_INTENCION, true);
  escribirSenal(CLAVE_DESCARTE, null);
  void navigator.serviceWorker
    .getRegistration()
    .then((registration) => registration?.waiting?.postMessage({ type: 'SKIP_WAITING' }))
    .catch(() => undefined);

  // El fallo se comprueba por **efecto**, no por precondición: que se haya
  // enviado el mensaje no significa nada, porque se puede perder, y el worker
  // puede pasar de `waiting` a `activating` entre la consulta y el envío, momento
  // en el que ya no hace nada y tampoco llega ningún `controllerchange`. Lo único
  // que dice la verdad es si la marca sigue puesta.
  //
  // Comprobarlo por efecto también es lo que limpia la marca: si se quedaba
  // armada, un `controllerchange` posterior recargaría la página sin que nadie lo
  // hubiera pedido, con un formulario a medio rellenar.
  setTimeout(() => {
    if (!hayRecargaPedida()) return;
    escribirSenal(CLAVE_INTENCION, false);
    setPendiente(false);
    showNotice(
      'No se ha podido recargar',
      'Cierra MiCasa del todo y ábrela de nuevo para aplicar la versión nueva.',
    );
  }, MS_SIN_RESPUESTA);
}

let vigilando = false;

/**
 * Se engancha a la actualización del service worker. Solo en web, y desde el
 * layout raíz: en una pantalla, el aviso no existiría en login ni en registro.
 */
export function vigilarActualizacion(): void {
  if (vigilando || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  vigilando = true;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Aquí es donde recarga. Es el punto correcto porque es cuando el control ya
    // ha cambiado de manos, y la recarga solo se pide desde el botón.
    if (!hayRecargaPedida()) return;
    escribirSenal(CLAVE_INTENCION, false);
    window.location.reload();
  });

  void navigator.serviceWorker
    .getRegistration()
    .then((registration) => {
      if (!registration) return;
      if (registration.waiting) marcarSiNoDescartada(registration.waiting.scriptURL);
      registration.addEventListener('updatefound', () => {
        const entrante = registration.installing;
        if (!entrante) return;
        entrante.addEventListener('statechange', () => {
          // `installed` con un worker ya activo: hay otro esperando a que se le
          // deje tomar el control. Sin worker activo es la primera instalación, y
          // eso no se recarga.
          if (entrante.state === 'installed' && navigator.serviceWorker.controller) {
            marcarSiNoDescartada(entrante.scriptURL);
          }
        });
      });
    })
    .catch(() => undefined);
}

function marcarSiNoDescartada(scriptUrl: string | null) {
  if (descartadaPara(scriptUrl)) return;
  setPendiente(true);
}

/** Solo para tests. */
export function resetForTests(): void {
  pendiente = false;
  vigilando = false;
  suscriptores.clear();
  escribirSenal(CLAVE_INTENCION, false);
  escribirSenal(CLAVE_DESCARTE, false);
  escribirSenal(CLAVE_DESCARTE_URL, null);
}
