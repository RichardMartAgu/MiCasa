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
 * Las funciones puras de este módulo (conversiones y normalización) están
 * separadas de las que tocan el navegador para poder testearlas con Jest.
 */

import { Platform } from 'react-native';

import type { User } from '@supabase/supabase-js';

import type { ReminderChoice } from './notification-schedule';
import { supabase } from './supabase';

/**
 * Clave pública VAPID. Es pública por diseño: el navegador la necesita para
 * crear la suscripción, igual que un id de API. Va en el código y no en
 * variables de entorno para no depender de la configuración de cada despliegue.
 * La privada nunca sale de Supabase Vault.
 */
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

/** Normaliza lo que devuelve `PushSubscription` a lo que espera la tabla. */
export function toSubscriptionRecord(subscription: {
  endpoint?: string | null;
  keys?: { p256dh?: string | null; auth?: string | null } | null;
}): PushSubscriptionRecord | null {
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

/**
 * Espera al service worker con un techo de tiempo. `navigator.serviceWorker.ready`
 * no resuelve si el registro falla (por ejemplo, cuando el chequeo de
 * Content-Type impide registrarlo), y sin este tope el botón de cerrar sesión se
 * quedaría colgado esperando.
 */
const SW_READY_TIMEOUT_MS = 3000;

async function readyRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), SW_READY_TIMEOUT_MS);
    navigator.serviceWorker.ready
      .then((registration) => {
        clearTimeout(timer);
        resolve(registration);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}

/** ¿Hay ya una suscripción activa en este navegador? */
export async function getActiveSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await readyRegistration();
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
    permission = await Notification.requestPermission();
  } catch (error) {
    return { status: 'failed', reason: errorText(error) };
  }
  if (permission !== 'granted') return { status: 'denied' };

  try {
    const registration = await readyRegistration();
    if (!registration) return { status: 'failed', reason: 'service worker no disponible' };

    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      }));

    const record = toSubscriptionRecord(subscription);
    if (!record) return { status: 'failed', reason: 'suscripción incompleta' };

    if (!user) return { status: 'failed', reason: 'sesión no válida' };

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
      return {
        status: 'failed',
        reason:
          error.code === '23505'
            ? 'este navegador ya está registrado en otra cuenta'
            : error.message,
      };
    }

    await syncPushPreferences(user, { enabled: true });
    return { status: 'enabled', record };
  } catch (error) {
    return { status: 'failed', reason: errorText(error) };
  }
}

/** Da de baja este navegador: borra la suscripción y el registro asociado. */
export async function disableWebPush(user: User | null): Promise<EnableResult> {
  if (!isPushSupported()) return { status: 'unsupported' };

  try {
    const registration = await readyRegistration();
    const subscription = registration ? await registration.pushManager.getSubscription() : null;
    const endpoint = subscription?.endpoint ?? null;

    if (subscription) await subscription.unsubscribe();

    if (endpoint) {
      const { error } = await supabase
        .from('push_subscriptions')
        .delete()
        .eq('endpoint', endpoint);
      if (error) return { status: 'failed', reason: error.message };
    }

    await syncPushPreferences(user, { enabled: false });
    return { status: 'disabled' };
  } catch (error) {
    return { status: 'failed', reason: errorText(error) };
  }
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
