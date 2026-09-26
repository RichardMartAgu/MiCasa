/**
 * Web Push en la web de MiCasa.
 *
 * En nativo los recordatorios los programa `expo-notifications` en el
 * dispositivo. En web no existe ese módulo: el flujo es otro.
 *
 * 1. El usuario activa el interruptor en Ajustes.
 * 2. Se pide permiso con la API de notificaciones y se crea la suscripción
 *    (`PushManager.subscribe`) con la clave pública VAPID.
 * 3. La suscripción se guarda en `push_subscriptions`, que es una credencial:
 *    solo su propietario puede leerla o borrarla (RLS).
 * 4. La Edge Function `send-web-push`, disparada por pg_cron, envía los
 *    recordatorios aunque la app esté cerrada.
 *
 * El alta no depende de que el service worker ya esté registrado (el `index.html`
 * lo registra en el evento `load`, que en una navegación larga puede no haber
 * ocurrido todavía) y toda la activación tiene techo de tiempo, porque una
 * promesa que se cuelga sin rechazar dejaba el interruptor de Ajustes inutilizable.
 *
 * Las funciones puras de este módulo (conversiones, normalización y presupuestos
 * de tiempo) están separadas de las que tocan el navegador para poder testearlas
 * con Jest sin navegador.
 */

import { Platform } from 'react-native';

import type { User } from '@supabase/supabase-js';

import type { ReminderChoice } from './notification-schedule';
import { supabase } from './supabase';
import { isTimeout, withTimeout, TimeoutError } from './with-timeout';
import {
  classifySubscribeFailure,
  SUBSCRIBE_FAILURE_MESSAGES,
  type SubscribeFailure,
} from './push-failures';

/**
 * Clave pública VAPID. Es pública por diseño: el navegador la necesita para
 * crear la suscripción, igual que un id de API. Va en el código y no en
 * variables de entorno para no depender de la configuración de cada despliegue.
 * La privada nunca sale de Supabase Vault.
 */
/**
 * Tope de la escritura del motivo de fallo. Va aparte del tope del alta porque
 * es una anotación de diagnóstico: si falla o se cuelga, el alta ya está fallada
 * de todos modos y lo que no puede pasar es que se pierda el motivo.
 */
const DIAGNOSTIC_WRITE_TIMEOUT_MS = 3000;

export const VAPID_PUBLIC_KEY =
  'BGAx5MQzNUhQM9rZxoKqQ5YlUG0Aj83vKNRGls0p2qAHn2ZGYT5CGKPokPzCWjgDaddVzL_0MIHp7P_rzcKr9P0';

/** Rutas internas a las que puede llevar un aviso. Espejo de sw-src.js. */
export const ALLOWED_PUSH_ROUTES = ['/citas', '/cumpleanos'] as const;

export type PushPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export interface PushSubscriptionRecord {
  endpoint: string;
  p256dh: string;
  auth: string;
  timezone: string;
  user_agent: string | null;
}

export type EnableResult =
  | { status: 'enabled'; record: PushSubscriptionRecord }
  | { status: 'disabled' }
  | { status: 'denied' }
  | { status: 'unsupported' }
  | { status: 'timeout'; reason: string }
  | { status: 'failed'; reason: string };

/**
 * Convierte una clave VAPID en base64url a bytes, que es lo que espera
 * `PushManager.subscribe`. Chromium lo acepta también como base64 estándar.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = typeof atob === 'function'
    ? atob(base64)
    : // Node/Jest no siempre trae atob en el global.
      Buffer.from(base64, 'base64').toString('binary');
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

/** Zona horaria IANA del navegador, con reserva a Madrid si no se puede leer. */
export function detectTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === 'string' && zone.length > 0 ? zone : 'Europe/Madrid';
  } catch {
    return 'Europe/Madrid';
  }
}

/** Motivo por el que una suscripción del navegador no sirve para enviar. */
export type IncompleteReason = 'sin-endpoint' | 'sin-p256dh' | 'sin-auth' | 'sin-claves';

export interface SubscriptionShape {
  endpoint?: string | null;
  keys?: { p256dh?: string | null; auth?: string | null } | null;
}

/**
 * Por qué la suscripción no sirve, en lugar de un `null` sin explicación.
 *
 * "Suscripción incompleta" no dice nada: no distingue entre que el navegador no
 * haya dado la clave de cifrado y que no haya dado la de autenticación, y esas
 * dos cosas tienen causas distintas. Con el motivo, el aviso al usuario puede
 * decir algo accionable y el registro permite saber qué pasa sin depender de que
 * nadie informe nada.
 */
export function incompleteReason(subscription: SubscriptionShape): IncompleteReason | null {
  if (!subscription.endpoint) return 'sin-endpoint';
  const keys = subscription.keys ?? null;
  if (!keys) return 'sin-claves';
  if (!keys.p256dh) return 'sin-p256dh';
  if (!keys.auth) return 'sin-auth';
  return null;
}

/** Texto que ve la persona, uno por cada motivo. Sin suponerse la causa. */
export const INCOMPLETE_MESSAGES: Record<IncompleteReason, string> = {
  'sin-endpoint':
    'El navegador no ha dado una dirección de entrega para los avisos. Suele pasar si la web se abrió en un modo que no admite notificaciones.',
  'sin-claves':
    'El navegador no ha dado las claves de cifrado de los avisos. Comprueba que los servicios de Google Play están activos y actualizados en el móvil, y que Chrome está al día.',
  'sin-p256dh':
    'El navegador no ha dado la clave pública de cifrado de los avisos. Suele indicar que no ha podido completar el registro con su servicio de notificaciones.',
  'sin-auth': 'El navegador no ha dado la clave de autenticación de los avisos.',
};

/** Normaliza lo que devuelve `PushSubscription` a lo que espera la tabla. */
export function toSubscriptionRecord(subscription: SubscriptionShape): PushSubscriptionRecord | null {
  const endpoint = subscription.endpoint ?? null;
  const p256dh = subscription.keys?.p256dh ?? null;
  const auth = subscription.keys?.auth ?? null;
  if (!endpoint || !p256dh || !auth) return null;

  let userAgent: string | null = null;
  try {
    userAgent = typeof navigator === 'undefined' ? null : navigator.userAgent.slice(0, 300);
  } catch {
    userAgent = null;
  }

  return {
    endpoint,
    p256dh,
    auth,
    timezone: detectTimeZone(),
    user_agent: userAgent,
  };
}

export function isPushSupported(): boolean {
  if (Platform.OS !== 'web') return false;
  if (typeof window === 'undefined') return false;
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function notificationPermission(): PushPermission {
  if (!isPushSupported()) return 'unsupported';
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission as PushPermission;
}

/* Reparto de temps de espera, que es la parte que más se ha tenido que razonar:
   el flujo mezcla una interacción humana con red, y un tope único no puede
   valer para las dos cosas. */

const SW_URL = '/sw.js';
const SW_SCOPE = '/';

/**
 * El registro del service worker ha fallado en esta sesión de página y no se
 * reintenta. Vive a nivel de módulo a propósito: la sorpresa que produce es de
 * página, no de componente, y así todos los caminos que necesitan el worker se
 * leveragesan el mismo veredicto en vez de repetir el intento por su cuenta.
 */
let registerUnavailable = false;

/**
 * Registro y posterior activación del service worker: descargar e instalar el
 * precaché entero del build en una móvil lenta es lo más caro de este flujo, y
 * aun así no depende de ninguna persona. Son dos fases con este mismo tope, así
 * que lo peor que pueden consumir juntas es el doble, que sigue entrando de
 * sobra en `ACTIVATION_TIMEOUT_MS`.
 */
export const SW_READY_TIMEOUT_MS = 10_000;

/**
 * Tope del diálogo de permisos, la única parte del flujo que depende de una
 * persona: en Android el diálogo nativo del sistema puede quedarse en pantalla
 * un rato, y cortar antes de que conteste produce el fallo que se quiere evitar
 * (permiso denegado sin haberlo denegado). Por eso va holgado y existe solo para
 * que un `requestPermission()` colgado no deje el interruptor muerto.
 */
export const PERMISSION_TIMEOUT_MS = 60_000;

/**
 * Tope de lo que ya no depende de nadie: alta del service worker,
 * `pushManager.subscribe()` (que se queda esperando a que FCM conteste) y las
 * peticiones a Supabase. Treinta segundos son un margen amplio para la red
 * móvil y estrechos para quien está mirando el interruptor, que es lo que hace
 * útil el aviso de "no ha terminado" en lugar de una espera muda.
 */
export const ACTIVATION_TIMEOUT_MS = 30_000;

/**
 * Tope global que aplica Ajustes como último recurso. Es la suma de los dos
 * anteriores más 10 s de margen a propósito: si el corte interior de este módulo
 * funciona, este nunca llega a vencer, de modo que solo aparece cuando el fallo
 * está por encima (y el interruptor nunca queda muerto ni aunque la capa de push
 * se rompa del todo).
 */
export const WEB_PUSH_TIMEOUT_MS = PERMISSION_TIMEOUT_MS + ACTIVATION_TIMEOUT_MS + 10_000;

/**
 * El registro que ya existe en este navegador, sin crear nada. Para leer el
 * estado actual no tiene sentido registrar un service worker nuevo: si no hay
 * registration, no hay suscripción que leer, y quien viene a mirar es una
 * operación de consulta.
 *
 * Se devuelve aunque su worker todavía no esté `activated`: `PushManager` acepta
 * un registration con el worker instalándose, y retenerlo hasta que active
 *convertía una espera normal en un "no hay suscripción" falso.
 */
async function existingRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

/**
 * Espera a que el worker que se está instalando pase a `activated`, con techo de
 * tiempo.
 *
 * El techo decide cuánto se espera al estado, pero **nunca** decide si hay
 * registration: eso se devuelve siempre. `PushManager` funciona con el worker
 * instalándose o en `waiting` igual que con el activo, así que antes de este
 * cambio, si el precaché del build tardaba más de 10 s en una móvil lenta, la
 * consulta respondía "no hay suscripción" con un navegador sí suscrito, y
 * quien intentaba activar se comía un "service worker no disponible" que era
 * mentira. Devolver `null` por un tiempo de espera lento era confundir una cosa
 * con otra.
 *
 * Sin `skipWaiting` a propósito (un deploy borra el service worker anterior y
 * activarlo por la fuerza abre una ventana en la que la página habla con un
 * worker viejo que ya no está en el servidor). El worker que espera en `waiting`
 * es un caso normal con esa decisión, no un fallo: por eso `clientsClaim` en
 * `sw-src.js` no compite con este camino, solo hace que el workertomara el
 * control antes.
 */
function waitForActivation(
  registration: ServiceWorkerRegistration,
  ms: number,
): Promise<ServiceWorkerRegistration> {
  if (registration.active) return Promise.resolve(registration);
  const worker = registration.installing ?? registration.waiting;
  if (!worker) return Promise.resolve(registration);

  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    const finish = () => {
      clearTimeout(timer);
      worker.removeEventListener('statechange', finish);
      resolve(registration);
    };
    timer = setTimeout(finish, ms);
    worker.addEventListener('statechange', finish);
  });
}

/**
 * Espera a que el worker quede **activo**, sin conformarse con "hay registration".
 *
 * Consultar y suscribir no son la misma operación, y por eso no comparten espera:
 * `getSubscription()` funciona con el worker instalándose, y por eso una consulta
 * no debe esperar a que termine el precaché del build. Pero
 * `pushManager.subscribe()` sí necesita un worker activo: llamado con el worker en
 * `installing` o `waiting`, Chrome devuelve una suscripción a medias, sin
 * `p256dh` ni `auth`, y eso llegaba al usuario como "suscripción incompleta" sin
 * más explicación. Suscribir es la única operación que tiene que exigir activo.
 */
async function waitUntilActive(
  registration: ServiceWorkerRegistration,
  ms: number,
): Promise<ServiceWorkerRegistration> {
  if (registration.active) return registration;

  const worker = registration.installing ?? registration.waiting;
  if (!worker) {
    throw new Error('el service worker no está listo');
  }

  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const finish = (error?: Error) => {
      clearTimeout(timer);
      worker.removeEventListener('statechange', onStateChange);
      if (error) reject(error);
      else resolve(registration);
    };
    const onStateChange = () => {
      if (worker.state === 'activated') finish();
      else if (worker.state === 'redundant') {
        // Un worker que se marca redundante no es un cuelgue: se rechazó, y
        // conviene distinguirlo de "no respondió" en el mensaje que ve la persona.
        finish(new Error('el service worker no se pudo activar'));
      }
    };
    // `TimeoutError` y no un `Error` cualquiera para que Ajustes lo trate como
    // "no ha terminado a tiempo" y no como un fallo con el que no puede hacer nada.
    timer = setTimeout(
      () => finish(new TimeoutError('el service worker tardó demasiado en activarse')),
      ms,
    );
    worker.addEventListener('statechange', onStateChange);
  });
}

/**
 * Registration con worker, registrándolo si hace falta.
 *
 * `public/index.html` registra el service worker en el evento `load` de la
 * ventana, así que hasta la navegación siguiente no existe registro y
 * `serviceWorker.ready` no resuelve nunca: ahí moría la activación con
 * "service worker no disponible" en cuanto se tocaba el interruptor antes de ese
 * `load`. Aquí el alta no depende de ese evento y se registra bajo demanda.
 *
 * `null` significa una sola cosa: que no se ha podido registrar el service
 * worker. Nunca "todavía no está activo".
 */
async function ensureRegistration(
  options: { requireActive: boolean } = { requireActive: false },
): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;

  const registered = await existingRegistration();
  if (registered) {
    if (!options.requireActive || registered.active) return registered;
    // Hay registration pero su worker todavía no controla la página: leer sí
    // valdría, suscribir no.
    return waitUntilActive(registered, SW_READY_TIMEOUT_MS);
  }

  // Un registro rechazado no se reintenta en cada montaje de Ajustes ni en cada
  // toque del interruptor: en `expo start`, `/sw.js` devuelve el index.html, el
  // navegador rechaza el MIME y un reintento solo añade ruido. El registro se
  // vuelve a intentar tras una recarga, que es cuando el despliegue ya cambió.
  if (registerUnavailable) return null;

  try {
    const registration = await withTimeout(
      navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE }),
      SW_READY_TIMEOUT_MS,
      'el service worker tardó demasiado en registrarse',
    );
    return options.requireActive
      ? await waitUntilActive(registration, SW_READY_TIMEOUT_MS)
      : await waitForActivation(registration, SW_READY_TIMEOUT_MS);
  } catch {
    registerUnavailable = true;
    return null;
  }
}

/**
 * ¿Hay ya una suscripción activa en este navegador?
 *
 * Usa `ensureRegistration` y no `activeRegistration` a propósito: Ajustes consulta
 * esto nada más montar, y el service worker solo se registra en el evento `load`
 * de `index.html`, unos segundos después de que React monte. Con una consulta
 * sin espera el interruptor aparecía apagado al recargar la página aunque el
 * navegador siguiera suscrito, y el usuario "-no" tenía forma de saber por qué.
 * Registrar no crea ninguna suscripción: solo garantiza que hay un worker
 * activo al que preguntarle.
 */
export async function getActiveSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await ensureRegistration();
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

/**
 * Activa los avisos en este navegador: pide permiso, crea la suscripción y la
 * guarda en Supabase. Devuelve un resultado con el motivo si algo falla, para
 * que la interfaz pueda explicar qué ha ocurrido.
 */
export async function enableWebPush(user: User | null): Promise<EnableResult> {
  if (!isPushSupported()) return { status: 'unsupported' };

  let permission: NotificationPermission;
  try {
    permission = await withTimeout(
      Notification.requestPermission(),
      PERMISSION_TIMEOUT_MS,
      'el navegador no respondió al pedir permiso',
    );
  } catch (error) {
    return failedBy(error);
  }
  if (permission !== 'granted') return { status: 'denied' };

  try {
    const record = await withTimeout(
      subscribeAndStore(user),
      ACTIVATION_TIMEOUT_MS,
      'la activación no ha terminado a tiempo',
    );
    return { status: 'enabled', record };
  } catch (error) {
    return failedBy(error);
  }
}


/**
 * Anota en `push_log` que el alta falló y por qué, para poder diagnosticarlo
 * desde la base sin depender de que la persona describa lo que ve.
 *
 * Solo escribe el motivo, nunca la suscripción: `p256dh` y `auth` son claves y
 * no tienen nada que ver con el diagnóstico. La clave incluye un momento para
 * que dos intentos seguidos no choquen en la restricción de unicidad.
 */
async function noteSubscriptionProblem(
  user: User | null,
  reason: IncompleteReason | SubscribeFailure,
): Promise<void> {
  if (!user) return;
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const { error } = await supabase
    .from('push_log')
    .insert({ user_id: user.id, dedupe_key: `alta:${reason}:${stamp}` });
  if (error) {
    // El diagnóstico no puede ser la razón por la que el alta falle.
    console.warn('No se pudo anotar el motivo del alta de avisos', reason);
  }
}

/**
 * Suscripción y alta en Supabase, sin el diálogo de permisos. Va aparte para que
 * el techo de tiempo sea solo suyo: es la parte del flujo que no espera a nadie.
 */
async function subscribeAndStore(user: User | null): Promise<PushSubscriptionRecord> {
  const registration = await ensureRegistration({ requireActive: true });
  if (!registration) throw new Error('service worker no disponible');

  const existing = await registration.pushManager.getSubscription();

  // Una suscripción sin `p256dh` o sin `auth` no sirve para enviar nada, y es
  // irrecuperable por la vía normal: `getSubscription()` la devuelve siempre, así
  // que un intento anterior que la dejó a medias convertía el alta en un
  // "suscripción incompleta" permanente con el que el usuario no puede hacer
  // nada. Por eso, si viene incompleta, se da de baja y se vuelve a crear.
  const usable = existing ? toSubscriptionRecord(existing) : null;
  if (existing && !usable) {
    // Con `try/catch` y no solo `.catch()`: si el navegador no permite darla de
    // baja, se sigue adelante con la nueva, que es lo que desbloquea al usuario.
    try {
      await existing.unsubscribe();
    } catch {
      // Se intenta de nuevo con una suscripción nueva igualmente.
    }
  }

  // El `subscribe()` es donde el navegador dice que no, y lo dice en inglés y sin
  // decir qué hacer. Se atrapa para poder (1) darle un motivo accionable y (2)
  // anotar el motivo en `push_log`, que es lo que permite leer en la base cuántos
  // fallos hay de cada tipo sin depender de que nadie describa lo que ve.
  let subscription: PushSubscription;
  if (usable && existing) {
    subscription = existing;
  } else {
    try {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
    } catch (error) {
      const reason = classifySubscribeFailure(
        error,
        typeof Notification === 'undefined' ? undefined : Notification.permission,
      );
      // Tope propio y corto: si la escritura del motivo se cuelga, lo que tiene
      // que verse es el motivo del fallo del navegador, no un "no ha terminado a
      // tiempo" que no explica nada. Esperar aquí sin tope canibaliza el
      // presupuesto de `ACTIVATION_TIMEOUT_MS` justo cuando más falta hace.
      await withTimeout(
        noteSubscriptionProblem(user, reason),
        DIAGNOSTIC_WRITE_TIMEOUT_MS,
        'diagnostico',
      ).catch(() => undefined);
      throw new Error(SUBSCRIBE_FAILURE_MESSAGES[reason]);
    }
  }

  const record = toSubscriptionRecord(subscription);
  if (!record) {
    const reason = incompleteReason(subscription) ?? 'sin-claves';
    // Se anota en `push_log` para poder leer qué devuelve el navegador sin
    // depender de que nadie informe: "suscripción incompleta" a secas no
    // distingue entre claves ausentes y una suscripción que nunca se registró.
    await noteSubscriptionProblem(user, reason);
    throw new Error(INCOMPLETE_MESSAGES[reason]);
  }

  if (!user) throw new Error('sesión no válida');

  // Nada de upsert por `endpoint`: la restricción es única y global, así que un
  // upsert sobre una fila de otra cuenta choca con la política UPDATE y
  // PostgREST devuelve error nulo, es decir, un "activado" falso mientras este
  // navegador sigue recibiendo los avisos de la cuenta anterior. Se borra lo
  // propio de este endpoint y se inserta; si el endpoint pertenece a otra
  // cuenta, el insert falla con 23505 y se informa.
  await supabase.from('push_subscriptions').delete().eq('endpoint', record.endpoint);

  const { error } = await supabase.from('push_subscriptions').insert({
    user_id: user.id,
    endpoint: record.endpoint,
    p256dh: record.p256dh,
    auth: record.auth,
    timezone: record.timezone,
    user_agent: record.user_agent,
    active: true,
  });

  if (error) {
    // La suscripción ya existe en el navegador aunque el alta haya fallado. Si
    // el endpoint es de otra cuenta (23505), dejarla viva significa que este
    // navegador sigue recibiendo los avisos de la cuenta anterior mientras el
    // interruptor marca que no hay nada que arreglar. Se da de baja local para
    // que el estado visible y el real coincidan.
    await subscription.unsubscribe().catch(() => undefined);
    throw new Error(
      error.code === '23505' ? 'este navegador ya está registrado en otra cuenta' : error.message,
    );
  }

  try {
    await syncPushPreferences(user, { enabled: true });
  } catch (error) {
    // La fila ya está escrita, así que los avisos van a llegar aunque la
    // preferencia haya fallado. Se dice igual, porque el usuario no puede
    // arreglarlo y suprimirlo dejaría un estado que no se puede recuperar.
    await subscription.unsubscribe().catch(() => undefined);
    throw error;
  }
  return record;
}

/** Da de baja este navegador: borra la suscripción y el registro asociado. */
export async function disableWebPush(user: User | null): Promise<EnableResult> {
  if (!isPushSupported()) return { status: 'unsupported' };

  try {
    await withTimeout(
      unsubscribeAndDelete(user),
      ACTIVATION_TIMEOUT_MS,
      'la baja no ha terminado a tiempo',
    );
    return { status: 'disabled' };
  } catch (error) {
    return failedBy(error);
  }
}

async function unsubscribeAndDelete(user: User | null): Promise<void> {
  // `ensureRegistration` por el mismo motivo que en `getActiveSubscription`: si
  // se desactiva nada más cargar, con una consulta sin espera no habría worker
  // activo, y la baja se iría sin borrar ni la suscripción del navegador ni la
  // fila, dejando avisos que llegan a un sitio que el usuario cree apagado.
  // Sin exigir worker activo: `unsubscribe()` y `getSubscription()` funcionan
  // con el worker instalándose, y una baja no puede quedarse esperando 10 s a que
  // termine el precaché para luego avisar de que no se pudo dar de baja.
  const registration = await ensureRegistration();
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  const endpoint = subscription?.endpoint ?? null;

  if (subscription) await subscription.unsubscribe();

  if (endpoint) {
    const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
    if (error) throw new Error(error.message);
  }

  await syncPushPreferences(user, { enabled: false });
}

/**
 * Un tope de tiempo y un fallo no son lo mismo para quien está mirando: el
 * primero casi siempre es un cuelgue que se puede reintentar, y el mensaje tiene
 * que poder decirlo.
 */
function failedBy(error: unknown): { status: 'timeout' | 'failed'; reason: string } {
  return isTimeout(error)
    ? { status: 'timeout', reason: error.message }
    : { status: 'failed', reason: errorText(error) };
}

/**
 * El servidor necesita conocer la preferencia de cumpleaños para decidir a quién
 * avisar cuando la app está cerrada, así que se replica en `push_preferences`.
 */
export async function syncPushPreferences(
  user: User | null,
  params: { birthdayChoice?: ReminderChoice; enabled?: boolean },
): Promise<void> {
  if (!user) return;

  const payload: {
    user_id: string;
    birthday_choice?: ReminderChoice;
    enabled?: boolean;
  } = { user_id: user.id };
  if (params.birthdayChoice) payload.birthday_choice = params.birthdayChoice;
  if (params.enabled !== undefined) payload.enabled = params.enabled;

  // Upsert y no select + write: con dos pestañas abiertas a la vez, el camino
  // select-then-insert puede chocar con la clave primaria y dejar la preferencia
  // sin guardar, que es justo cuando más pasa (acabas de tocar el interruptor).
  const { error } = await supabase
    .from('push_preferences')
    .upsert(payload, { onConflict: 'user_id' });

  if (error) throw new Error(error.message);
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'error desconocido';
}

export type TestPushResult =
  | { ok: true; delivered: number }
  | { ok: false; error: string; retryInSeconds?: number };

/**
 * Pide un aviso de prueba a la Edge Function. Sirve para comprobar que la
 * suscripción está viva y que el service worker pinta la notificación, sin
 * esperar a que llegue un recordatorio real.
 *
 * La función se autentica con el JWT de esta sesión y solo puede avisar a este
 * usuario, así que no hay forma de llegar a nadie más. Enfrenta un enfriamiento
 * de 5 minutos por si alguien lo pulsa en bucle.
 */
export async function sendTestPush(): Promise<TestPushResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { ok: false, error: 'sesión no válida' };

  const baseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/functions/v1/send-web-push?mode=test`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
    });
  } catch {
    return { ok: false, error: 'sin conexión' };
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'respuesta ilegible' };
  }

  if (!response.ok) {
    return { ok: false, error: typeof body.error === 'string' ? body.error : 'error inesperado' };
  }
  if (body.ok === true) {
    return { ok: true, delivered: typeof body.delivered === 'number' ? body.delivered : 0 };
  }
  if (body.error === 'demasiado rapido') {
    return {
      ok: false,
      error: 'demasiado rapido',
      retryInSeconds: typeof body.retryInSeconds === 'number' ? body.retryInSeconds : 60,
    };
  }
  return { ok: false, error: typeof body.error === 'string' ? body.error : 'error inesperado' };
}
