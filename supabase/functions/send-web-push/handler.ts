import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// `EdgeRuntime` es global del Supabase Edge Runtime: mantiene viva la función
// para que termine el trabajo en segundo plano. Se declara aquí en vez de tirar
// de las tipografías del runtime (que importa `index.ts`) para que este módulo
// se pueda importar en un test sin arrastrar ese shim.
declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

import { corsHeaders, jsonResponse, preflightResponse, resolveAllowedOrigins } from "./cors.ts";
import {
  appointmentQueryUpperBound,
  birthdayChoiceFor,
  buildAppointmentDispatches,
  buildBirthdayDispatches,
  buildNowAppointmentDispatch,
  buildNowBirthdayDispatch,
  dedupeKey,
  isPushEnabled,
  isValidChoice,
  isValidTimeZone,
  localDayUtc,
  nowDedupeKey,
  type AppointmentRow,
  type ContactRow,
  type NowDispatch,
  type PushPreference,
  type TargetedDispatch,
} from "./reminders.ts";

/**
 * Atiende las peticiones de `send-web-push`: el dispatcher que dispara pg_cron y
 * el aviso de prueba que pide el usuario desde Ajustes.
 *
 * Va en su propio módulo y no en `index.ts` para que se pueda importar en un
 * test: `index.ts` llama a `Deno.serve` al cargarse, que levantaría un servidor
 * dentro del runner. Aquí no hay ningún `Deno.env` a nivel de módulo (todo se
 * lee dentro de `handle`, a través del `env` que se le pase), así que importar
 * el módulo no arranca nada ni depende de que haya secretos configurados.
 *
 * Envía los recordatorios de MiCasa por Web Push. La dispara pg_cron cada pocos
 * minutos a través de pg_net. No acepta JWT de usuario: se autentica con el
 * secreto compartido PUSH_CRON_SECRET en la cabecera `x-cron-secret`. La clave de
 * servicio solo se usa internamente para leer suscripciones y escribir en
 * push_log; nunca sale de la función.
 *
 * Idempotencia: cada envío se anota en push_log con la clave
 * `tipo:id:slot:dia`. Si pg_cron se solapa o reintenta, el conflicto de la
 * clave única evita el duplicado.
 *
 * CORS: vive en `cors.ts` y solo se usa para poner cabeceras. Nunca decide si una
 * petición se atiende, porque el dispatcher la llama sin `Origin` y rechazarla por
 * eso apagaría los recordatorios.
 */

/** Remitente VAPID por defecto. Es una dirección de contacto, no un secreto. */
const DEFAULT_VAPID_SUBJECT = "mailto:notificaciones@micasa.app";

/** Lo mínimo de `Deno.env` que necesita la función. */
type EnvReader = { get(name: string): string | undefined };

/** Ventana de normalización hacia atrás: cubre reintentos y retrasos del cron. */
const CATCHUP_MINUTES = 180;
/** Envíos fallidos seguidos antes de marcar la suscripción como inactiva. */
const MAX_FAILURES = 5;
/** Días que se conservan los registros de push_log. */
const LOG_RETENTION_DAYS = 30;
const MAX_TTL_SECONDS = 12 * 60 * 60;

interface PushSecrets {
  publicKey: string;
  privateKey: string;
  cronSecret: string;
  /** Remitente VAPID (`mailto:...`) que firma los envíos. */
  subject: string;
}

/**
 * Las claves VAPID y el secreto del cron viven en Supabase Vault, no como
 * variables de entorno: así no hacen falta la Management API ni el CLI para
 * desplegar. Si algún día se añaden como variables de entorno, mandan sobre
 * Vault.
 *
 * Se pide de uno en uno, y el primero (el del cron) antes de autenticar: una
 * petición sin credencial no debe poder forzar la creación del cliente con
 * service role ni la lectura de la clave VAPID privada.
 */
/**
 * ¿Este error deja la suscripción inservible para siempre?
 *
 * El caso que motivó el fichero: en producción había una fila con `p256dh` de nueve
 * caracteres. Pasa cualquier validación de forma —es base64url, no hay espacios, no
 * está vacía— y es imposible de cifrar, así que esa fila no se borraba nunca. El
 * botón de aviso de prueba fallaba con un error de criptografía en la cara de la
 * persona, y el reparto la reintentaba cada cinco minutos para siempre.
 *
 * El listón es deliberadamente altísimo, y por una razón que costó un incidente:
 * borrar una fila no lo revierte nada del lado del servidor. Solo se recupera si
 * esa persona apaga y enciende el push a mano, sin ningún aviso de que toque. Así
 * que un falso positivo le cuesta a alguien real todos sus avisos, y un falso
 * negativo cuesta un reintento más. Ante la duda, la suscripción se conserva.
 *
 * Se distinguen de un fallo de red, que sí es transitorio: aquí el error describe
 * datos que no van a mejorar solos.
 *
 * Solo se borra cuando el mensaje NOMBRA el material de la suscripción. Un error
 * genérico del criptográfico no clasifica, porque no se puede atribuir: el mismo
 * "error:1E08010C:DECODER routines::unsupported" lo produce una clave VAPID del
 * servidor mal puesta, y eso es configuración compartida por todos.
 *
 * Los literales son de `encryption-helper.js` y de `web-push-lib.js` en
 * web-push@3.6.7:
 *   'The subscription p256dh value should be 65 bytes long.'
 *   'The subscription auth key should be at least 16 bytes long.'
 *   'To send a message with a payload, the subscription must have \'auth\' and \'p256dh\' keys.'
 *
 * Ninguno es un `TypeError`: web-push lanza `Error` plano para todo lo que no es
 * respuesta HTTP. Una versión anterior exigía `instanceof TypeError` y dejaba este
 * predicado como código muerto, con el caso real —el `p256dh` de nueve caracteres—
 * pasando por el contador en vez de por aquí. Cinco ejecuciones después la
 * suscripción quedaba apagada, que es peor que reintentar: se perdían los avisos
 * sin dejar rastro en ningún log.
 */
// Los dos literales de `encryption-helper.js` que NO están aquí, a propósito:
// 'No user public key provided for encryption.' y 'No user auth provided for
// encryption.' Hoy son inalcanzables: `sendNotification` llama a
// `generateRequestDetails` ANTES de cifrar, y ahí ya lanza el mensaje de
// 'auth' y 'p256dh' que sí está en la lista. Se anotan porque si un upgrade de
// `web-push` reordenara el cifrado antes de la validación, entrarían por la vía del
// contador y apagarían suscripciones a los cinco ciclos, en silencio. Quien suba
// la versión del paquete tiene que volver a comprobar este orden.
const UNUSABLE_SUBSCRIPTION_MARKERS: readonly string[] = [
  // `encryption-helper.js`.
  "subscription p256dh value",
  "subscription auth key",
  // `web-push-lib.js`, que valida la suscripción ANTES de cifrar y con literales
  // distintos. Sin estos, una suscripción con `p256dh` o `auth` vacíos —que
  // `encryption-helper` ni llega a ver— caía en el contador y a los cinco ciclos
  // quedaba apagada sin dejar rastro.
  "subscription must have 'auth' and 'p256dh' keys",
  "subscription endpoint must be a string",
  "subscription with at least an endpoint",
];

export function isUnusableSubscription(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  if (isVapidConfigurationError(message)) return false;
  return UNUSABLE_SUBSCRIPTION_MARKERS.some((marker) => message.includes(marker));
}

/**
 * ¿El mensaje no se puede atribuir a la suscripción sino a la configuración?
 *
 * Hace falta por dos motivos. Uno: un mensaje de `vapid-helper.js` que contenga
 * un marcador no debe confundirse con material de suscripción. Dos, y el importante:
 * ampliar la lista de arriba en el futuro no debe poder reintroducir el fallo por
 * el camino corto, que es borrar la flota entera por una VAPID mal puesta.
 */
function isVapidConfigurationError(lowerMessage: string): boolean {
  // Solo se comprueba que el mensaje nombre VAPID, y nada más. El caso difícil —
  // una clave VAPID de 65 bytes que revienta en `createECDH` con un mensaje
  // indistinguible del criptográfico— se resuelve en la OTRA dirección: la lista
  // de marcadores no incluye palabras del criptográfico, así que ese error nunca
  // clasifica.
  //
  // Se probó mantener aquí también el filtro criptográfico, y es un error: dos
  // mecanismos que se compensan. Al quitar cualquiera de los dos, el otro tapaba
  // el fallo y la suite seguía en verde, que es justo cuando un mecanismo se
  // queda sin comprobar.
  return lowerMessage.includes("vapid");
}


async function readSecret(db: Db, name: string, fallback: string): Promise<string> {
  if (fallback.length > 0) return fallback;
  const { data, error } = await db.rpc("push_service_secret", { secret_name: name });
  if (error) {
    console.error(`send-web-push: no se pudo leer el secreto ${name} de Vault`, String(error));
    return "";
  }
  return typeof data === "string" ? data : "";
}

/**
 * Lee el par de claves VAPID. Van aparte de `readSecret` porque los dos caminos
 * de la función los necesitan en momentos distintos: el dispatcher solo puede
 * leerlas después de pasar el gate del cron, y el aviso de prueba solo puede
 * leerlas después de validar la sesión de quien lo pide. Quien llama decide el
 * orden; este helper solo agrupa la lectura y el mensaje de error.
 */
async function readVapidKeys(
  db: Db,
  env: EnvReader,
): Promise<{ publicKey: string; privateKey: string } | null> {
  const publicKey = await readSecret(db, "vapid_public_key", env.get("VAPID_PUBLIC_KEY") ?? "");
  const privateKey = await readSecret(db, "vapid_private_key", env.get("VAPID_PRIVATE_KEY") ?? "");
  if (!publicKey || !privateKey) {
    console.error("send-web-push: faltan las claves VAPID en Vault o en el entorno");
    return null;
  }
  return { publicKey, privateKey };
}

/** Comparación en tiempo constante para no filtrar el secreto por temporización. */
function safeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

interface SubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  timezone: string;
  failure_count: number;
}

interface Group {
  userId: string;
  timezone: string;
  subs: SubscriptionRow[];
}

function groupByUserAndTimezone(subs: SubscriptionRow[], zonasInvalidasVistas: Set<string>): Group[] {
  const groups = new Map<string, Group>();
  for (const sub of subs) {
    // Una zona que `Intl` no entiende se queda fuera del reparto, y no se intenta
    // avisar con ella. `push_subscriptions.timezone` solo tiene un `check` de 64
    // caracteres, así que el valor viene de la base y no de una validación: sin
    // este filtro, `Intl` lanzaba `RangeError` dentro de `buildDispatches` y tumbaba
    // el lote entero. No recibía nadie ese ciclo —tampoco las casas que no tienen
    // nada que ver con esa fila— y con `sync=1` además devolvía un 500.
    //
    // Se descarta la fila y se avisa una vez por ejecución, porque una suscripción
    // con la zona rota seguiría intentándolo en cada reparto mientras nadie mire.
    if (!isValidTimeZone(sub.timezone)) {
      if (!zonasInvalidasVistas.has(sub.id)) {
        zonasInvalidasVistas.add(sub.id);
        console.error(
          `send-web-push: suscripción con zona horaria no válida, se omite sub=${sub.id}`,
        );
      }
      continue;
    }
    const key = `${sub.user_id}|${sub.timezone}`;
    const existing = groups.get(key);
    if (existing) existing.subs.push(sub);
    else groups.set(key, { userId: sub.user_id, timezone: sub.timezone, subs: [sub] });
  }
  return [...groups.values()];
}


type Db = SupabaseClient;

/** Fábrica del cliente de la función. Sustituible en los tests; ver `HandlerDeps`. */
type DbFactory = (supabaseUrl: string, serviceRoleKey: string) => Db;

function defaultCreateDb(supabaseUrl: string, serviceRoleKey: string): Db {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Lo mínimo de `web-push` que usa la función. Existe para poder sustituirlo en un
 * test: `setVapidDetails` guarda el remitente en estado de módulo, así que si el
 * módulo real se usa en un test la configuración de un test se fuga al siguiente
 * y no hay forma de afirmar que se llamó antes de enviar.
 */
export interface WebPushLike {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options: { TTL: number; urgency: string },
  ): Promise<unknown>;
}

/** Lo que los tests sustituyen: con qué base de datos, con qué reloj y con qué push. */
export interface HandlerDeps {
  createDb?: DbFactory;
  now?: () => number;
  push?: WebPushLike;
}

/**
 * Casas de las que el usuario sigue siendo miembro, o `null` si no se pudo leer.
 *
 * El filtro está porque alguien expulsado de una casa conserva sus filas en
 * `appointments` (solo se borra su `casa_members`), así que sin esto seguiría
 * recibiendo por push los títulos y horas de las citas de esa casa, aunque la UI
 * ya no se las muestra.
 *
 * `null` no es lo mismo que `[]`: un fallo transitorio al leer `casa_members` no
 * significa que el usuario no pertenezca a ninguna casa, y confundirlos hacía que
 * quien llama afirmara algo falso (un 404 diciendo que no tienes casas cuando lo
 * que pasó es que la base de datos no respondió). Falla hacia el lado seguro —no se
 * avisa de nada—, pero el motivo tiene que poder distinguirse.
 */
async function fetchCasaIds(db: Db, userId: string): Promise<string[] | null> {
  const { data, error } = await db
    .from("casa_members")
    .select("casa_id")
    .eq("user_id", userId);

  if (error) {
    console.error("send-web-push: no se pudieron leer las casas del usuario", String(error));
    return null;
  }
  return ((data ?? []) as { casa_id: string }[]).map((m) => m.casa_id);
}

/** Citas propias, en casas de las que sigue siendo miembro, con recordatorio. */
async function fetchAppointments(
  db: Db,
  userId: string,
  casaIds: string[],
  now: Date,
  from: Date,
): Promise<AppointmentRow[] | null> {
  if (casaIds.length === 0) return [];

  const { data, error } = await db
    .from("appointments")
    .select("id, title, starts_at, reminder_choice")
    .eq("user_id", userId)
    .in("casa_id", casaIds)
    .in("reminder_choice", ["day-before", "same-day", "both"])
    .gte("starts_at", from.toISOString())
    .lte("starts_at", appointmentQueryUpperBound(now).toISOString());

  if (error) {
    console.error("send-web-push: no se pudieron leer las citas", String(error));
    return null;
  }
  return (data ?? []) as AppointmentRow[];
}

/** Contactos con fecha de nacimiento de todas las casas del usuario. */
async function fetchBirthdayContacts(db: Db, casaIds: string[]): Promise<ContactRow[] | null> {
  if (casaIds.length === 0) return [];

  const { data, error } = await db
    .from("contacts")
    .select("id, name, birth_date")
    .in("casa_id", casaIds)
    .not("birth_date", "is", null);

  if (error) {
    console.error("send-web-push: no se pudieron leer los contactos", String(error));
    return null;
  }
  return (data ?? []) as ContactRow[];
}

async function buildDispatches(
  db: Db,
  groups: Group[],
  now: Date,
  from: Date,
): Promise<TargetedDispatch[]> {
  const out: TargetedDispatch[] = [];

  for (const group of groups) {
    const context = { now, timeZone: group.timezone, window: { from, to: now } };
    const target = { userId: group.userId, timezone: group.timezone };

    // El interruptor maestro es global del usuario y frena TODO lo que sale por
    // push, citas incluidas. Sin esta comprobación, apagar "Cumpleaños: sin
    // aviso" dejaba las citas llegando igual: el usuario veía el interruptor
    // apagado y los seguientes recibiendo avisos.
    const { data: prefs, error: prefsError } = await db
      .from("push_preferences")
      .select("birthday_choice, enabled")
      .eq("user_id", group.userId)
      .maybeSingle();

    if (prefsError) {
      // Fallo cerrado: si no se puede leer la preferencia, no se envía nada. Con
      // la otra opción, un error transitorio de la base reactivaba los avisos de
      // un usuario que los tenía apagados.
      console.error("send-web-push: no se pudieron leer las preferencias", String(prefsError));
      continue;
    }

    // Sin cast: `PushPreference` ya modela la fila tal y como es, con
    // `birthday_choice` sin validar, que es lo que permite que
    // `birthdayChoiceFor` pueda mirar un valor ilegible.
    const pref = (prefs ?? null) as PushPreference | null;
    if (!isPushEnabled(pref)) continue;

    const casaIds = await fetchCasaIds(db, group.userId);
    // `null` y `[]` se saltan el grupo los dos, y a propósito: el dispatcher no
    // tiene a quién responderle un 500, y no avisar es lo seguro cuando no se sabe
    // qué casas tiene.
    if (casaIds === null || casaIds.length === 0) continue;

    const appointments = await fetchAppointments(db, group.userId, casaIds, now, from);
    if (appointments !== null) {
      out.push(...buildAppointmentDispatches(appointments, context).map((d) => ({ ...d, ...target })));

    }

    const choice = birthdayChoiceFor(pref);
    if (choice !== "none") {
      const contacts = await fetchBirthdayContacts(db, casaIds);
      if (contacts !== null) {
        out.push(...buildBirthdayDispatches(contacts, choice, context).map((d) => ({ ...d, ...target })));
      }
    }
  }

  return out;
}

/** Resultado de intentar entregar un payload a las suscripciones de un usuario. */
interface SendResult {
  delivered: number;
  removed: number;
  /**
   * No se pudieron LEER las suscripciones. No es lo mismo que no tener ninguna, y
   * quien llama depende de la diferencia: con la lectura fallida no se puede decir
   * "no tienes suscripciones activas" porque no se sabe, y sueltar la reserva de
   * `push_log` dejaría el aviso reintentable en bucle con un motivo falso.
   */
  readFailed: boolean;
  /**
   * Algún envío falló por la configuración del servidor y no por la suscripción.
   * Quien llama lo necesita para no responder "no tienes suscripciones" a alguien
   * que sí las tiene: es la diferencia entre un motivo verdad y uno inventado.
   */
  infraFailed: boolean;
}

/**
 * Configura las claves VAPID del módulo `webpush`.
 *
 * `web-push` guarda el remitente en estado de módulo y no en el envío, así que
 * hay que configurarlo ANTES de cada tanda. Los isolates de Edge Functions son
 * efímeros: un lote que arranque en frío no hereda nada de otro, y sin esto
 * `sendNotification` lanza por falta de remitente.
 *
 * Existe como función y no como línea en cada sitio porque HAY dos sitios que
 * envían —`sendToUser` y el bucle del repartidor— y esa duplicación ya costó un
 * bug: al extraer `sendToUser` se movió la llamada dentro de él con un
 * comentario que decía que era el único que enviaba, y el repartidor se quedó
 * sin VAPID. Desde entonces ningún recordatorio de día antes ni del mismo día
 * salió, y como el fallo se tragaba la reserva de `push_log` no dejaba ni fila.
 * Quien añada un tercer sitio tiene que llamar a esto primero.
 */
function configureWebPush(push: WebPushLike, secrets: PushSecrets): void {
  push.setVapidDetails(secrets.subject, secrets.publicKey, secrets.privateKey);
}

/**
 * Identificador de un aviso para los logs, sin la zona horaria.
 *
 * Hace falta porque `dedupeKey` lleva la zona —para que dos navegadores en zonas
 * distintas no compartan la reserva— y eso significa que imprimir `key` en los logs
 * sacaba la zona del servidor al log retenido, que es justo lo que la regla del
 * módulo prohíbe: la zona, junto con el resto de la fila de la suscripción,
 * identifica a una persona concreta y cualquiera con acceso al proyecto lo lee.
 *
 * Lo que sale es lo mismo que ya identificaba un aviso: tipo, referencia, slot y
 * día local. Si dos navegadores de la misma persona reciben el mismo aviso, en el
 * log se ven dos líneas iguales, y eso es aceptable: la pregunta que responde un
 * log es "qué aviso es" y "se entregó o no", no "a qué zona ha ido".
 */
function claveDeDiagnostico(dispatch: TargetedDispatch): string {
  return `${dispatch.type}:${dispatch.refId}:${dispatch.slot}:${dispatch.localDay}`;
}

/**
 * ¿Este fallo es de la infraestructura y no de la suscripción?
 *
 * Un 401 o un 403 del push service no dice nada de la suscripción: dice que las
 * claves VAPID están mal, que se han rotado o que hay una configuración de gateway
 * rota. Es lo mismo para todos los usuarios a la vez. Contarlo como fallo de la
 * suscripción apagaba la flota entera en silencio, que es el modo de fallo más caro
 * que hay: nadie recibe avisos, y recuperar cada suscripción apagada exige que
 * esa persona apague y encienda el push a mano, sin ningún aviso de que toca.
 *
 * Es también el fallo que costó los recordatorios de este repo: un `setVapidDetails`
 * que no se llamaba lanzaba aquí, se contaba como fallo de la suscripción, y a los
 * cinco intentos la suscripción quedaba apagada. Por eso esto se decide por el
 * código de estado y no por "no se pudo enviar".
 *
 * Lo que NO entra aquí: 429, 5xx y fallos de red. Esos sí son transitorios y sí son
 * de la suscripción a efectos de reintentar, que es lo que hace el contador.
 */
export function isInfrastructureFailure(error: unknown): boolean {
  const status = (error as { statusCode?: number } | null)?.statusCode;
  return status === 401 || status === 403;
}

/** Envía un payload ya construido a las suscripciones de un usuario. */
async function sendToUser(
  db: Db,
  push: WebPushLike,
  secrets: PushSecrets,
  userId: string,
  payload: { title: string; body: string; data: { type: string; id: string; url: string } },
): Promise<SendResult> {
  // Se configura aquí y no en quien llama porque quien llama son dos sitios
  // distintos y el que se olvidara fue el repartidor; ver `configureWebPush`.
  configureWebPush(push, secrets);

  const { data: subs, error } = await db
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, failure_count")
    .eq("user_id", userId)
    .eq("active", true);

  if (error) {
    console.error("send-web-push: no se pudieron leer las suscripciones del usuario", String(error));
    return { delivered: 0, removed: 0, readFailed: true, infraFailed: false };
  }

  let delivered = 0;
  const dead: string[] = [];
  let infraFailed = false;

  for (const sub of (subs ?? []) as { id: string; endpoint: string; p256dh: string; auth: string }[]) {
    try {
      await push.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({
          title: payload.title,
          body: payload.body,
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          // El service worker vuelve a componer el `tag` a partir de `data.type` e
          // `data.id` (ver sw-src.js), así que aquí van los dos de verdad: si
          // `type` fuera siempre "test", el aviso de confirmación se pintaría como
          // genérico y, además, se apilaría con los avisos de prueba.
          tag: `${payload.data.type}:${payload.data.id}`,
          renotify: true,
          data: payload.data,
        }),
        { TTL: 300, urgency: "normal" },
      );
      delivered++;
      await db
        .from("push_subscriptions")
        .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
        .eq("id", sub.id);
    } catch (error) {
      const status = (error as { statusCode?: number } | null)?.statusCode;
      if (status === 404 || status === 410 || isUnusableSubscription(error)) {
        dead.push(sub.id);
        continue;
      }
      if (isInfrastructureFailure(error)) {
        // La configuración, no la suscripción. Se distingue porque quien llama
        // responde con un motivo: sin esto, un push service con las claves VAPID
        // rotas devolvía "no tienes suscripciones activas" a alguien que sí las
        // tenía, y además quemaba el enfriamiento con ese motivo falso.
        infraFailed = true;
        console.error("send-web-push: fallo de infraestructura en el envío", String(error));
        continue;
      }
      console.error("send-web-push: fallo enviando el aviso de prueba", String(error));
    }
  }

  if (dead.length > 0) await db.from("push_subscriptions").delete().in("id", dead);
  return { delivered, removed: dead.length, readFailed: false, infraFailed };
}

/**
 * Segundos que faltan para que empiece el siguiente bucket de enfriamiento.
 *
 * Se devuelve en el cuerpo de la respuesta y no solo en un log: quien llama
 * necesita poder decirle a la persona cuánto tiene que esperar, y adivinarlo en el
 * cliente es justo lo que un enfriamiento mal medido hace frustrante.
 */
function secondsToNextBucket(now: number, bucket: number, bucketMs: number): number {
  return Math.ceil(((bucket + 1) * bucketMs - now) / 1000);
}

/**
 * Aviso de prueba que pide el propio usuario desde Ajustes.
 *
 * Se autentica con el JWT de la sesión y solo puede llegar a las suscripciones de
 * quien lo pide: no hay forma de usarlo para avisar a otra cuenta ni de elegir el
 * contenido, que es fijo.
 *
 * El enfriamiento se apoya en la clave única de `push_log` en vez de en un
 * marca de tiempo: así funciona entre réplicas de la función sin estado propio, y
 * no hay que tocar `push_preferences` (escribir ahí el instante del envío
 * reactivaría el interruptor maestro de quien lo pulse).
 *
 * La fila no se suelta en ninguna de las tres salidas —duplicada, lectura fallida
 * y lista vacía—, y por eso el enfriamiento se aplica también en el estado
 * trivial de un navegador sin suscripciones. Esa es justo la razón de existir del
 * enfriamiento, así que soltarla en el caso vacío lo dejaba sin efecto.
 */
const TEST_PUSH_COOLDOWN_MS = 5 * 60_000;

async function runTestPush(
  db: Db,
  push: WebPushLike,
  secrets: PushSecrets,
  userId: string,
  now: number,
): Promise<Record<string, unknown>> {
  const bucket = Math.floor(now / TEST_PUSH_COOLDOWN_MS);
  const { error: claimError } = await db
    .from("push_log")
    .insert({ user_id: userId, dedupe_key: `test:${userId}:${bucket}` });

  if (claimError) {
    if (claimError.code !== "23505") {
      console.error("send-web-push: no se pudo registrar el aviso de prueba", String(claimError));
      return { ok: false, error: "no se pudo registrar el aviso" };
    }
    return {
      ok: false,
      error: "demasiado rapido",
      retryInSeconds: secondsToNextBucket(now, bucket, TEST_PUSH_COOLDOWN_MS),
    };
  }

  const result = await sendToUser(db, push, secrets, userId, {
    title: "MiCasa: aviso de prueba",
    body: "Si lees esto, los avisos de verdad te llegaran con el movil bloqueado.",
    data: { type: "test", id: userId, url: "/" },
  });

  // La reserva se queda puesta si no se pudo ni leer la lista: soltarla dejaría el
  // botón reintentable en bucle con un motivo falso en la cara.
  if (result.readFailed) {
    return { ok: false, error: "no se pudieron leer tus suscripciones" };
  }

  if (result.infraFailed) {
    // Va ANTES del `delivered === 0` a propósito: con la configuración rota no
    // hay suscripciones que avisar, pero el motivo no es que no las tenga. Y la
    // reserva se queda, que es lo que hace de enfriamiento.
    return { ok: false, error: "el servidor no pudo enviar: configuracion de push rota" };
  }

  if (result.delivered === 0) {
    // Aquí la reserva se QUEDA, y antes se soltaba. Con cero suscripciones —el
    // estado trivial de un navegador sin el push activo— el enfriamiento no se
    // aplicaba nunca, que es justo el caso para el que existe: "por si alguien lo
    // pulsa en bucle" (ver `sendTestPush` en la app). Soltarla convertía
    // `?mode=test` en el mismo bucle sin límite que ya se cerró en `mode=now`.
    //
    // Se acepta que quien active el push en otro momento espere cinco minutos: es
    // preferible a devolverle un botón que se puede martillear sin coste para
    // nadie. Bajar el enfriamiento no sería la manera de arreglarlo, porque reabre
    // el bucle; si de verdad hace falta poder reintentar antes, tiene que ser con
    // otro mecanismo, no soltando la fila.
    return { ok: false, error: "sin suscripciones activas en este navegador" };
  }

  return { ok: true, delivered: result.delivered, removedSubscriptions: result.removed };
}

/**
 * Zona horaria con la que se compone el aviso.
 *
 * La que manda el cliente es la de lo que el usuario está viendo ahora mismo, así
 * que se prefiere si `Intl` la entiende. Si no, se cae a la de su suscripción
 * activa (que es con la que el cron le manda las cosas) y, en último caso, a la
 * del proyecto. Nunca se usa el valor crudo sin comprobar: es entrada del cliente.
 */
async function resolveUserTimeZone(
  db: Db,
  userId: string,
  requested: string | null,
): Promise<string> {
  if (isValidTimeZone(requested)) return requested;

  const { data } = await db
    .from("push_subscriptions")
    .select("timezone")
    .eq("user_id", userId)
    .eq("active", true)
    .limit(1)
    .maybeSingle();

  const stored = (data as { timezone?: unknown } | null)?.timezone;
  return isValidTimeZone(stored) ? stored : DEFAULT_VAPID_SUBJECT_TIMEZONE;
}

/** Zona por defecto del proyecto. Es la de `casa` en la mayoría de cuentas. */
const DEFAULT_VAPID_SUBJECT_TIMEZONE = "Europe/Madrid";

/**
 * Aviso de confirmación que pide el cliente al acabar de crear una cita o un
 * cumpleaños: "esto ya queda avisado".
 *
 * No es el recordatorio. El recordatorio lo sigue mandando el cron, y por eso la
 * clave de esta confirmation lleva el prefijo `now:` (ver `nowDedupeKey`): con la
 * clave del cron, esta función se comería el aviso de verdad.
 *
 * Se autentica por la sesión, no por el secreto del cron, así que solo puede
 * avisar a quien lo pide. Y no puede avisar de lo que el cron no avisaría: la fila
 * se lee con el mismo filtro de visibilidad que usa `buildDispatches` (miembro de
 * la casa, y para citas además el autor). Un exmiembro de una casa conserva sus
 * filas en `appointments` porque solo se le borra de `casa_members`, así que sin
 * ese filtro seguiría recibiendo los títulos y horas de una casa a la que ya no
 * pertenece, aunque la UI ya no se los muestre.
 */
/**
 * Los `id` de `appointments` y `contacts` son `uuid`. Comprobarlo aquí evita que un
 * valor con otra forma llegue a la consulta: PostgREST responde con un error de
 * sintaxis, que sin esto se devolvería como un 500 ("no se pudo leer la cita") cuando
 * de verdad es una petición mal formada. Y corta antes de que un `searchParams`
 * arbitrariamente largo llegue a la base de datos.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Enfriamiento de la confirmación, en buckets por usuario.
 *
 * Un minuto, y no los cinco del aviso de prueba, porque el uso real de este camino
 * es humano: confirmar la cita o el cumpleaños que acabas de crear, una o dos veces.
 * Con cinco minutos, guardar un cumpleaños y corregir la casa se comía el aviso sin
 * motivo. Y con un minuto tampoco frena lo que hay que frenar, que es el bucle:
 * mil peticiones por minuto siguen siendo mil, pero ninguna pasa de la primera
 * fila de `push_log`.
 *
 * Y no es solo un enfriamiento. La fila se pide antes de validar el tipo, el id y
 * antes de cualquier consulta de negocio (ver `runNowPush`), así que el bucket
 * acota el trabajo de TODAS las peticiones de este modo, incluidas las que ni
 * siquiera llegan a preguntar por una referencia.
 */
const NOW_PUSH_COOLDOWN_MS = 60_000;

async function runNowPush(
  db: Db,
  push: WebPushLike,
  secrets: PushSecrets,
  userId: string,
  params: URLSearchParams,
  now: number,
): Promise<{ body: Record<string, unknown>; status: number }> {
  const fail = (error: string, status: number) => ({ body: { ok: false, error }, status });

  // La reserva va PRIMERO, antes de validar el tipo, el id y antes de cualquier
  // consulta de negocio. Antes iba al final, después de leer preferencias, zona,
  // casas y la referencia, y eso dejaba trece salidas tempranas —casi todas 4xx
  // de validación— que no escribían nada. Con lo que el bucle más barato que
  // quedaba era `?mode=now&type=appointment&id=<uuid aleatorio>`: un 404 de "esa
  // cita no existe" después de haber pagado la validación de sesión, las dos
  // llamadas a Vault y la consulta de la referencia, con cero filas escritas y sin
  // enfriamiento. Mismo perfil de coste que el bucle ya cerrado, y más barato
  // porque no necesita ni un contacto real.
  //
  // El precio de moverlo es que ahora un 400 o un 403 de validación también quema
  // el bucket. Se acepta a conciencia: los dos sitios que llaman a este camino
  // hacen fire-and-forget y tiran el retorno, así que para la UX no cambia nada; a
  // cambio ninguna petición repite su trabajo sin pagar al menos un insert.
  //
  // Y no se suelta nunca en este camino: ni con `delivered === 0`, ni con
  // `readFailed`, ni con un fallo inesperado, ni con ninguna de las salidas
  // tempranas. Soltarla en cualquiera de ellas devuelve el bucle.
  const bucket = Math.floor(now / NOW_PUSH_COOLDOWN_MS);
  const retryInSeconds = secondsToNextBucket(now, bucket, NOW_PUSH_COOLDOWN_MS);
  // Lo que esta fila significa ya no es "esta referencia quedó confirmada" sino
  // "este usuario pidió una confirmación dentro de este minuto". Por eso la
  // variable se llama reserva y no `key` de confirmación: es una reserva de usuario
  // y minuto, y no un registro de lo que se confirmó ni de lo que se va a confirmar.
  const reserva = nowDedupeKey(userId, bucket);
  const { error: claimError } = await db
    .from("push_log")
    .insert({ user_id: userId, dedupe_key: reserva });

  if (claimError) {
    // 23505 = este usuario ya tiene una reserva viva en este minuto. No sale ningún
    // push y no es un fallo del cliente: reintentar en bucle no produce un aviso
    // nuevo, solo más peticiones.
    //
    // Por eso `ok` es false y no true: antes devolvía `ok: true` con
    // `delivered: 0`, que se contradicen —nada salió y algo se dice que salió— y que
    // además se leía como que el aviso estaba confirmado. El motivo y los segundos
    // que faltan viajan con él para que quien lo use pueda decir qué hacer, que es
    // lo mismo que hace `sendTestPush` con "demasiado rapido". El prefijo `now:` de
    // la clave es lo que garantiza que esto no choca con el recordatorio del cron.
    if (claimError.code === "23505") {
      return {
        body: { ok: false, skipped: true, error: "ya se confirmo en este minuto", retryInSeconds },
        status: 200,
      };
    }
    // Cualquier otro error es de la base de datos, no una duplicidad. Aquí sí se
    // aborta: seguir significaría enviar sin haber reservado nada, que es el
    // duplicado que `push_log` existe para evitar.
    console.error("send-web-push: no se pudo reservar la confirmacion", String(claimError));
    return fail("no se pudo registrar el aviso", 500);
  }

  const type = params.get("type");
  const refId = params.get("id");
  if (type !== "appointment" && type !== "birthday") return fail("tipo invalido", 400);
  if (refId === null || !UUID_PATTERN.test(refId)) return fail("id invalido", 400);

  // Consentimiento. El interruptor maestro frena TODO lo que sale por push, y este
  // camino no es una excepción: si el usuario lo apagó en Ajustes, confirmar que
  // quedó avisado también es un push. Sin preferences se asume activado, igual que
  // en el dispatcher, porque llegar aquí ya implica una sesión viva.
  const { data: prefs, error: prefsError } = await db
    .from("push_preferences")
    .select("birthday_choice, enabled")
    .eq("user_id", userId)
    .maybeSingle();

  if (prefsError) {
    // Fallo cerrado, por el mismo motivo que en `buildDispatches`: con la otra
    // opción, un error transitorio de la base reactivaba los avisos de un usuario
    // que los tenía apagados.
    console.error("send-web-push: no se pudieron leer las preferencias", String(prefsError));
    return fail("no se pudieron leer tus preferencias", 500);
  }

  // Sin cast: `PushPreference` modela la fila sin validar `birthday_choice`, que es
  // lo que permite mirar un valor ilegible sin que el compilador lo llame imposible.
  const pref = (prefs ?? null) as PushPreference | null;
  if (!isPushEnabled(pref)) return fail("los avisos estan apagados", 403);
  if (type === "birthday" && birthdayChoiceFor(pref) === "none") {
    return fail("no tienes aviso de cumpleanos activado", 403);
  }

  const timeZone = await resolveUserTimeZone(db, userId, params.get("timezone"));
  const today = localDayUtc(new Date(now), timeZone);

  // Mismo criterio de visibilidad que `buildDispatches`.
  const casaIds = await fetchCasaIds(db, userId);
  if (casaIds === null) return fail("no se pudieron leer tus casas", 500);
  if (casaIds.length === 0) return fail("no perteneces a ninguna casa", 404);

  let dispatch: NowDispatch | null = null;

  if (type === "appointment") {
    const { data, error } = await db
      .from("appointments")
      .select("id, title, starts_at, reminder_choice")
      .eq("id", refId)
      .eq("user_id", userId)
      .in("casa_id", casaIds)
      .maybeSingle();

    if (error) {
      console.error("send-web-push: no se pudo leer la cita", String(error));
      return fail("no se pudo leer la cita", 500);
    }
    if (!data) return fail("esa cita no existe", 404);

    const appointment = data as AppointmentRow;
    dispatch = buildNowAppointmentDispatch({
      refId: appointment.id,
      title: appointment.title,
      startsAt: appointment.starts_at,
      choice: isValidChoice(appointment.reminder_choice) ? appointment.reminder_choice : "none",
      timeZone,
    });
  } else {
    const { data, error } = await db
      .from("contacts")
      .select("id, name, birth_date")
      .eq("id", refId)
      .in("casa_id", casaIds)
      .maybeSingle();

    if (error) {
      console.error("send-web-push: no se pudo leer el contacto", String(error));
      return fail("no se pudo leer el contacto", 500);
    }
    if (!data) return fail("ese contacto no existe", 404);

    const contact = data as ContactRow;
    dispatch = buildNowBirthdayDispatch({
      refId: contact.id,
      name: contact.name,
      birthDate: contact.birth_date,
      choice: birthdayChoiceFor(pref),
      today,
    });
  }

  // La fila existe y es visible, pero no hay recordatorio que confirmar. No es un
  // error: el cliente solo lo llama cuando el usuario eligió un recordatorio. La
  // reserva de arriba se queda; el bucket ya está gastado.
  if (!dispatch) return fail("no hay recordatorio que confirmar", 404);

  try {
    const result = await sendToUser(db, push, secrets, userId, {
      title: dispatch.title,
      body: dispatch.body,
      data: { type: dispatch.type, id: dispatch.refId, url: dispatch.url },
    });

    if (result.readFailed) {
      // La reserva se queda: no sabemos si había a quién avisar, y soltarla
      // devolvería el bucle con un motivo falso en cada vuelta.
      return fail("no se pudieron leer tus suscripciones", 500);
    }

    if (result.infraFailed) {
      return fail("el servidor no pudo enviar: configuracion de push rota", 502);
    }

    if (result.delivered === 0) {
      // Nadie lo recibió (típicamente: sin suscripciones en este navegador). La
      // reserva NO se suelta: es ella la que hace de enfriamiento, y ahora además
      // es lo único que separa dos peticiones de este camino, porque se pide antes
      // de validar nada.
      return {
        body: {
          ok: false,
          error: "sin suscripciones activas",
          retryInSeconds,
        },
        status: 404,
      };
    }

    return {
      body: { ok: true, delivered: result.delivered, removedSubscriptions: result.removed },
      status: 200,
    };
  } catch (error) {
    // `sendToUser` ya captura los fallos por suscripción, así que llegar aquí es
    // un fallo inesperado. La reserva se queda igualmente: ahora se pide antes de
    // validar nada, así que soltarla aquí volvería a abrir el bucle que la fila
    // cierra. El precio es un minuto sin poder reintentar y una fila de más, y lo
    // paga un camino que casi no se recorre; soltarla lo pagaría todo el mundo.
    console.error("send-web-push: fallo en el aviso de confirmacion", String(error));
    return fail("no se pudo enviar el aviso", 500);
  }
}

/** Reparte y envía todos los recordatorios pendientes. */
async function runDispatch(db: Db, push: WebPushLike, secrets: PushSecrets, now: number): Promise<Record<string, unknown>> {
  const instante = new Date(now);
  const windowStart = new Date(instante.getTime() - CATCHUP_MINUTES * 60_000);

  // Logs de diagnóstico del reparto (2026-10-05).
  //
  // Solo se loguea lo que ocurre cuando HAY algo que repartir. Un log por
  // ejecución daría 288 líneas/día para decir siempre lo mismo, y con eso el
  // diario se llena de ruido justo cuando toca buscar el motivo de un fallo.

  // Las claves VAPID van antes de leer nada: sin ellas, todo lo que viene
  // debajo falla al cifrar y la reserva de `push_log` se suelta, así que el
  // fallo sale y se reintenta sin dejar rastro. Ver `configureWebPush`.
  configureWebPush(push, secrets);

  // La poda va PRIMERO, antes de leer nada. Estaba al final, y `dispatches` solo
  // existe dentro de la ventana de catchup alrededor de las 09:00 locales, así que
  // con la poda detrás del `return` de "no hay nada que repartir" se quedaba sin
  // ejecutar casi siempre: fuera de esa ventana la tabla no se podaba nunca. Y
  // `mode=now` escribe filas `now:*` a cualquier hora del día, con lo que crecía
  // sin techo justo en las horas en las que el cron no tenía nada que repartir.
  //
  // Nadie lee `push_log` para diagnosticar: en el repo solo hay `insert`, `delete` y
  // `update` sobre esa tabla, así que podar antes no le quita nada a nadie.
  await db
    .from("push_log")
    .delete()
    .lt("sent_at", new Date(instante.getTime() - LOG_RETENTION_DAYS * 86_400_000).toISOString());

  const { data: subs, error: subsError } = await db
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth, timezone, failure_count")
    .eq("active", true);

  if (subsError) {
    console.error("send-web-push: no se pudieron leer las suscripciones", String(subsError));
    return { ok: false, error: "fallo al leer suscripciones" };
  }

  // Vive aquí y no en el módulo a propósito. Un `Set` de módulo sobrevive entre
  // invocaciones en un isolate caliente, y el aviso de "esta suscripción tiene la
  // zona rota" tiene que volver a salir en cada ejecución: si nadie lo arregla en
  // un par de horas, que vuelva a aparecer. En un `Set` de módulo salía una vez en
  // toda la vida del isolate y luego callaba para siempre, que es el peor sitio
  // para un aviso que es lo único que hay.
  const zonasInvalidasVistas = new Set<string>();
  const groups = groupByUserAndTimezone((subs ?? []) as SubscriptionRow[], zonasInvalidasVistas);

  const dispatches = await buildDispatches(db, groups, instante, windowStart);

  for (const d of dispatches) {
    // Sin `userId` ni `timezone`: los dos identifican a una persona concreta en un
    // log retenido y accesible a cualquiera con acceso al proyecto, y no hacen
    // falta para diagnosticar. `refId` y `slot` bastan para saber qué aviso es, y
    // por eso ningún log imprime `dedupeKey`: esa clave lleva la zona desde que
    // dos navegadores con zonas distintas dejaron de compartir la reserva. Los
    // logs usan `claveDeDiagnostico`, que es la clave sin la zona. El título de la
    // cita y el nombre del contacto tampoco salen, y eso sí que no puede salir
    // nunca.
    console.log(`send-web-push: dispatch type=${d.type} refId=${d.refId} slot=${d.slot} fireDay=${d.localDay}`);
  }

  if (dispatches.length === 0) {
    return { ok: true, dispatched: 0, sent: 0, skipped: 0, window: CATCHUP_MINUTES };
  }

  let sent = 0;
  let skipped = 0;
  const dead: string[] = [];
  /**
   * Si algún envío de esta ejecución falló por infraestructura y no por
   * suscripción.
   *
   * Su único efecto es que el `console.error` se escriba UNA vez por lote y no una
   * por cada envío, que es cuando un humano lo va a leer. No decide nada sobre las
   * reservas: eso lo hace la regla única de "nadie lo recibió, se libera", que
   * vale igual para un 403 que para un 429.
   */
  let fallosDeInfraEnElLote = false;
  /**
   * Fallos acumulados por suscripción DENTRO de esta ejecución.
   *
   * Antes se calculaba `failure_count` desde el valor leído al principio del run,
   * y eso metía dos errores. Uno: si un aviso entregaba bien ponía el contador a 0
   * en la base, pero un aviso posterior que fallara en la MISMA ejecución
   * reescribía `valorViejo + 1` encima de ese 0. Con el valor viejo en 4, una
   * suscripción que acababa de entregar acababa en 5 y se desactivaba. Dos: una
   * suscripción que fallara en dos avisos metía dos filas y se escribía dos veces.
   *
   * Aquí se lleva la cuenta en memoria y se escribe una sola vez al final, con el
   * estado consolidado de toda la ejecución.
   */
  const fallosEnEstaEjecucion = new Map<string, number>();

  for (const dispatch of dispatches) {
    const key = dedupeKey(dispatch);


    // Idempotencia: solo envía la ejecución que gana la restricción de unicidad.
    const { error: claimError } = await db
      .from("push_log")
      .insert({ user_id: dispatch.userId, dedupe_key: key });

    if (claimError) {
      // 23505 = clave duplicada: otra ejecución ya lo envió.
      if (claimError.code === "23505") {
        console.log(`send-web-push: dispatch skipped (duplicate) key=${claveDeDiagnostico(dispatch)}`);
        skipped++;
        continue;
      }
      console.error("send-web-push: no se pudo reservar el envio", String(claimError));
      continue;
    }

    console.log(`send-web-push: reservada key=${claveDeDiagnostico(dispatch)}`);
    const group = groups.find((g) => g.userId === dispatch.userId && g.timezone === dispatch.timezone);
    let delivered = 0;

    for (const sub of group?.subs ?? []) {
      try {
        await push.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({
            title: dispatch.title,
            body: dispatch.body,
            icon: "/icon-192.png",
            badge: "/icon-192.png",
            tag: `${dispatch.type}:${dispatch.refId}`,
            renotify: false,
            data: {
              type: dispatch.type,
              id: dispatch.refId,
              slot: dispatch.slot,
              url: dispatch.url,
            },
          }),
          { TTL: MAX_TTL_SECONDS, urgency: "normal" },
        );
        delivered++;
        console.log(`send-web-push: notification delivered sub=${sub.id} key=${claveDeDiagnostico(dispatch)}`);
        await db
          .from("push_subscriptions")
          .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
          .eq("id", sub.id);
        // El contador de esta ejecución se resetea también, no solo el de la base:
        // si otro aviso de la MISMA ejecución falla después, tiene que partir de
        // cero y no del valor con el que se leía la fila al empezar.
        fallosEnEstaEjecucion.set(sub.id, 0);
      } catch (error) {
        const status = (error as { statusCode?: number } | null)?.statusCode;
        if (status === 404 || status === 410) {
          // El navegador se dio de baja o el servicio caducó el endpoint.
          dead.push(sub.id);
          console.log(`send-web-push: subscription dead sub=${sub.id} status=${status}`);
          continue;
        }
        if (isUnusableSubscription(error)) {
          // Las claves no sirven y no van a servirlas nunca: no tiene sentido
          //dejarlo para el próximo intento ni contar un fallo más.
          dead.push(sub.id);
          console.log(`send-web-push: subscription unusable sub=${sub.id}`);
          continue;
        }
        if (isInfrastructureFailure(error)) {
          // Configuración, no suscripción. No se cuenta como fallo de la
          // suscripción porque el contador acaba desactivando a gente cuya
          // suscripción es perfectamente válida. La reserva sí se suelta, por la
          // regla común de más abajo: un 429 transitorio ya la suelta y reintenta
          // cada cinco minutos dentro de la ventana, así que tratar el 403 de otra
          // forma perdía el recordatorio de ese día sin evitar reintentos. Se
          // registra una vez por ejecución, que es cuando alguien lo va a leer.
          if (!fallosDeInfraEnElLote) {
            console.error(
              `send-web-push: fallo de infraestructura al enviar, no se cuenta como fallo de suscripción: ${String(error)}`,
            );
          }
          fallosDeInfraEnElLote = true;
          continue;
        }
        // 429, 5xx y red: transitorios y sí son de la suscripción, que es lo que
        // el contador sabe medir. Se parte del estado de esta ejecución, no del
        // valor con el que se leyó la fila.
        const count = (fallosEnEstaEjecucion.get(sub.id) ?? sub.failure_count ?? 0) + 1;
        fallosEnEstaEjecucion.set(sub.id, count);
        console.log(`send-web-push: send failed sub=${sub.id} count=${count} error=${String(error)}`);
      }
    }

    if (delivered > 0) {
      sent++;
      console.log(`send-web-push: dispatch sent key=${claveDeDiagnostico(dispatch)} delivered=${delivered}`);
    } else if ((group?.subs.length ?? 0) > 0) {
      // El aviso se reservó pero nadie lo recibió: se libera la reserva para que
      // otra ejecución pueda reintentar dentro de la ventana.
      //
      // Se suelta también cuando lo que falló fue la infraestructura, y es una
      // decisión. La alternativa era conservarla y perder ese aviso para siempre,
      // y conservarla solo tiene sentido si no reintentar sale gratis. No sale: un
      // 429 —transitorio, y justo al lado— ya suelta la reserva y reintenta cada
      // cinco minutos durante las tres horas de ventana. Tratar el 403 de otra
      // forma era incoherente y costaba el recordatorio. El techo de reintentos es
      // el mismo que ya se aceptaba para el rate limit.
      //
      // Lo que nunca se reintenta es el `failure_count`: un fallo de
      // infraestructura no toca el contador, y por eso una suscripción válida no
      // se apaga porque el servidor tuviera la clave VAPID mal puesta.
      await db.from("push_log").delete().eq("user_id", dispatch.userId).eq("dedupe_key", key);
      console.log(`send-web-push: aviso reservado y no entregado, reserva liberada key=${claveDeDiagnostico(dispatch)}`);
    }
  }

  // Un solo paso de escritura por suscripción, con el estado consolidado de toda
  // la ejecución. Una suscripción que entregó en algún momento queda con 0 y sale
  // del contador, aunque otro aviso suyo haya fallado antes.
  for (const [id, count] of fallosEnEstaEjecucion) {
    if (dead.includes(id)) continue;
    await db
      .from("push_subscriptions")
      .update({ failure_count: count, active: count < MAX_FAILURES })
      .eq("id", id);
  }

  if (dead.length > 0) await db.from("push_subscriptions").delete().in("id", dead);

  return {
    ok: true,
    users: groups.length,
    dispatched: dispatches.length,
    sent,
    skipped,
    removedSubscriptions: dead.length,
    window: CATCHUP_MINUTES,
  };
}

/**
 * Atiende una petición.
 *
 * `env` se inyecta para que los tests puedan pasar un entorno vacío y no
 * depender de los secretos que tenga la máquina. Por defecto es `Deno.env`.
 *
 * `deps` inyecta el cliente de Supabase, el reloj y el módulo de push. Los tests
 * los necesitan: sin un doble de base de datos no hay forma de comprobar qué
 * consulta sale cuando una falla, sin reloj fijo el bucket depende del instante en
 * que corre el test, y sin un doble de push no se puede afirmar que VAPID se
 * configuró antes de enviar. En producción no se pasa nada y se usan los de verdad.
 */
export async function handle(
  req: Request,
  env: EnvReader = Deno.env,
  deps: HandlerDeps = {},
): Promise<Response> {
  // Los orígenes se resuelven ANTES del try, y no dentro, para que la red de
  // seguridad de abajo no pueda quedar sin los datos que necesita para armar su
  // propia respuesta: si la resolución fallara, el `catch` todavía tiene `origin` y
  // `allowedOrigins` y puede devolver un 500 con CORS en vez de propagar el error
  // fuera de `handle`, donde `Deno.serve` respondería sin cabeceras.
  const allowedOrigins = resolveAllowedOrigins(env.get("WEB_PUSH_ALLOWED_ORIGINS"));
  const origin = req.headers.get("origin");

  try {
    return await handleRequest(req, env, deps, allowedOrigins, origin);
  } catch (error) {
    // Red de seguridad, no camino previsto. `Deno.serve` en `index.ts` no tiene
    // catch, así que una excepción que se escapara de aquí salía como un 500 pelado
    // y sin cabeceras CORS: el navegador no podía ni leer por qué había fallado, que
    // es justo lo que este módulo se ocupa de que no pase en ninguna respuesta.
    console.error("send-web-push: fallo no controlado", String(error));
    return jsonResponse({ error: "error interno" }, 500, corsHeaders(origin, allowedOrigins));
  }
}

async function handleRequest(
  req: Request,
  env: EnvReader,
  deps: HandlerDeps,
  allowedOrigins: readonly string[],
  origin: string | null,
): Promise<Response> {
  // `allowedOrigins` y `origin` los resuelve `handle` y llegan aquí ya hechos: si
  // esa resolución lanzara dentro del catch, el 500 saldría sin cabeceras CORS,
  // que es justo el fallo que la red de seguridad tiene que tapar.

  // Preflight antes que nada, y antes incluso de mirar la configuración: es una
  // respuesta vacía que no lee secretos ni toca la base de datos. Sin esto el
  // navegador no llega a mandar el POST, que es lo que dejaba muerto el botón
  // "Enviar" de Ajustes.
  if (req.method === "OPTIONS") return preflightResponse(origin, allowedOrigins);

  // Todas las respuestas de esta petición, incluidas las de error, salen con las
  // cabeceras CORS ya resueltas: si el 401 o el 405 no las llevan, el navegador
  // no puede ni leer por qué falló.
  const json = (body: unknown, status = 200): Response =>
    jsonResponse(body, status, corsHeaders(origin, allowedOrigins));

  // El `Origin` no se mira en esta comprobación, y a propósito: el dispatcher la
  // llama por `pg_net` sin `Origin`, así que si la función exigiera un origen, el
  // cron dejaría de mandar recordatorios. El CORS solo decide si la respuesta
  // lleva permiso de lectura.
  if (req.method !== "POST") return json({ error: "metodo no permitido" }, 405);

  const supabaseUrl = env.get("SUPABASE_URL");
  const serviceRoleKey = env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    // 401 y no 500: todas las rutas de "no puedo hacerlo" devuelven lo mismo,
    // para que la respuesta no revele si la configuración está cargada.
    console.error("send-web-push: faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
    return json({ error: "no autorizado" }, 401);
  }

  const createDb = deps.createDb ?? defaultCreateDb;
  const clock = deps.now ?? Date.now;

  /**
   * El módulo real de `web-push` por defecto. Va por `deps` para que un test
   * pueda sustituirlo: guarda el remitente en estado de módulo, así que usarlo
   * en un test mezclaría la configuración entre tests y no dejaría afirmar que
   * se configuró ANTES de enviar, que es justo el invariante que importó.
   *
   * En producción `index.ts` llama a `handle(req)` sin el tercer argumento, así
   * que aquí siempre cae al módulo real. En los tests, el guion de la base de
   * datos decide si hace falta sustituirlo: los que tienen suscripciones en su
   * guion lo hacen, y los que no las tienen no llegan a enviar.
   *
   * Eso hoy es una convención y no una garantía: un test futuro que tenga
   * suscripciones en el guion y se olvide de inyectar `push` haría un `fetch`
   * HTTPS de verdad contra el endpoint de mentira que le haya puesto. El fallo
   * sería ruidoso —un error de red, no un `true`— así que no puede hacer pasar un
   * test en verde por error, que es el modo de fallo que importa aquí.
   */
  const push = deps.push ?? webpush;

  const db = createDb(supabaseUrl, serviceRoleKey);

  const subject = env.get("VAPID_SUBJECT") ?? DEFAULT_VAPID_SUBJECT;

  const mode = new URL(req.url).searchParams.get("mode");

  // Modos que se autentican con la sesión del usuario: el aviso de prueba de
  // Ajustes y la confirmación de una cita o cumpleaños recién creado.
  //
  // Este grupo va ANTES del gate del secreto del cron, y no por descuido: ese gate
  // protege al dispatcher, que tiene alcance global, y estos dos no lo tienen
  // porque solo pueden avisar a quien se acaba de autenticar. Con el gate delante,
  // el botón de Ajustes no tenía forma de mandar el secreto (no debe viajar en un
  // bundle) y respondía 401 siempre: estaba muerto.
  //
  // El orden que sí importa es otro: primero se valida la sesión y solo después se
  // leen las claves VAPID de Vault, para que una petición sin sesión válida no
  // llegue a tocar ningún secreto.
  if (mode === "test" || mode === "now") {
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (token.length === 0) return json({ error: "falta la sesion" }, 401);

    const { data: userData, error: userError } = await db.auth.getUser(token);
    if (userError || !userData?.user) return json({ error: "sesion no valida" }, 401);

    const userVapid = await readVapidKeys(db, env);
    if (!userVapid) return json({ error: "no autorizado" }, 401);

    // `cronSecret` vacío a propósito: estos caminos no lo usan, y así no se
    // construye un valor que luego se lee sin querer.
    const userSecrets: PushSecrets = { cronSecret: "", subject, ...userVapid };
    const userId = userData.user.id;

    if (mode === "now") {
      const result = await runNowPush(db, push, userSecrets, userId, new URL(req.url).searchParams, clock());
      return json(result.body, result.status);
    }

    return json(await runTestPush(db, push, userSecrets, userId, clock()));
  }

  // Antes de autenticar solo se lee el secreto del cron, y se hace por entorno
  // si existe. Así, una petición sin credencial no llega a leer la clave VAPID
  // privada ni a despachar nada. (El cliente con service role sí se crea antes,
  // porque hace falta para el RPC; lo que no se evita es esa consulta a Vault.)
  const cronSecret = await readSecret(db, "push_cron_secret", env.get("PUSH_CRON_SECRET") ?? "");
  const provided = req.headers.get("x-cron-secret") ?? "";
  // Si falta la configuración se responde igual que con secreto incorrecto: un
  // 500 distinto serviría de oráculo para saber si las claves están cargadas.
  if (cronSecret.length === 0) {
    console.error("send-web-push: falta PUSH_CRON_SECRET en Vault o en el entorno");
    return json({ error: "no autorizado" }, 401);
  }
  if (!safeEqual(provided, cronSecret)) return json({ error: "no autorizado" }, 401);

  const vapid = await readVapidKeys(db, env);
  if (!vapid) return json({ error: "no autorizado" }, 401);

  const secrets: PushSecrets = { cronSecret, subject, ...vapid };

  const sync = new URL(req.url).searchParams.get("sync") === "1";
  if (sync) {
    return json(await runDispatch(db, push, secrets, clock()));
  }

  // pg_net aborta la llamada a los 5 s, y el arranque en frío de la función ya
  // consume más que eso. Por eso el cron solo encola: el trabajo real sigue en
  // segundo plano con waitUntil. `?sync=1` existe para depurar a mano.
  EdgeRuntime.waitUntil(
    runDispatch(db, push, secrets, clock()).catch((error) => {
      console.error("send-web-push: fallo en el reparto", String(error));
    }),
  );
  return json({ ok: true, queued: true }, 202);
}
