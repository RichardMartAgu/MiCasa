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
  type ReminderType,
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
 * Si esta suscripción no puede volver a funcionar nunca.
 *
 * Un 404 o un 410 del servicio de push significa que el endpoint caducó, y eso ya
 * lo treatment el llamador. Lo que no estaba tratado es el otro caso permanent: unas
 * claves que el navegador no puede haber dado de verdad. Medido: una fila con
 * `p256dh` de nueve caracteres, suficiente para pasar cualquier validación de
 * forma pero imposible de cifrar, hacia que `web-push` lanzara un `TypeError` al
 * descifrar. Esa fila no se borraba nunca: el botón de aviso de prueba fallaba con
 * un error de criptografía en la cara de la persona, y el reparto la reintentaba
 * cada cinco minutos para siempre.
 *
 * Se distinguen de un fallo de red, que sí es transitorio: aquí el error es de
 * tipo, no de estado, y viene de leer las claves.
 */
export function isUnusableSubscription(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  const message = String((error as Error).message ?? "").toLowerCase();
  return message.includes("base64") || message.includes("decode") || message.includes("key");
}

async function readSecret(db: Db, name: string, fallback: string): Promise<string> {
  if (fallback.length > 0) return fallback;
  const { data, error } = await db.rpc("push_service_secret", { secret_name: name });
  if (error) {
    console.error(`send-web-push: no se pudo leer el secreto ${name} de Vault`, error);
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

function groupByUserAndTimezone(subs: SubscriptionRow[]): Group[] {
  const groups = new Map<string, Group>();
  for (const sub of subs) {
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

/** Lo que los tests sustituyen: con qué base de datos y con qué reloj. */
export interface HandlerDeps {
  createDb?: DbFactory;
  now?: () => number;
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
    console.error("send-web-push: no se pudieron leer las casas del usuario", error);
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
    console.error("send-web-push: no se pudieron leer las citas", error);
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
    console.error("send-web-push: no se pudieron leer los contactos", error);
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
      console.error("send-web-push: no se pudieron leer las preferencias", prefsError);
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
}

/** Envía un payload ya construido a las suscripciones de un usuario. */
async function sendToUser(
  db: Db,
  secrets: PushSecrets,
  userId: string,
  payload: { title: string; body: string; data: { type: string; id: string; url: string } },
): Promise<SendResult> {
  // Configurar las claves VAPID aquí y no en quien llama: `sendToUser` es el
  // único sitio que despacha, y hay dos caminos que llegan (el dispatcher y el
  // aviso de prueba). Configurarlas solo en el dispatcher dejaba al aviso de
  // prueba enviando sin VAPID, que es un rechazo del.push service.
  webpush.setVapidDetails(secrets.subject, secrets.publicKey, secrets.privateKey);

  const { data: subs, error } = await db
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, failure_count")
    .eq("user_id", userId)
    .eq("active", true);

  if (error) {
    console.error("send-web-push: no se pudieron leer las suscripciones del usuario", error);
    return { delivered: 0, removed: 0, readFailed: true };
  }

  let delivered = 0;
  const dead: string[] = [];

  for (const sub of (subs ?? []) as { id: string; endpoint: string; p256dh: string; auth: string }[]) {
    try {
      await webpush.sendNotification(
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
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410 || isUnusableSubscription(error)) {
        dead.push(sub.id);
        continue;
      }
      console.error("send-web-push: fallo enviando el aviso de prueba", error);
    }
  }

  if (dead.length > 0) await db.from("push_subscriptions").delete().in("id", dead);
  return { delivered, removed: dead.length, readFailed: false };
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
 * reactivaría el interruptor maestro de quien lo pulses).
 */
const TEST_PUSH_COOLDOWN_MS = 5 * 60_000;

async function runTestPush(
  db: Db,
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
      console.error("send-web-push: no se pudo registrar el aviso de prueba", claimError);
      return { ok: false, error: "no se pudo registrar el aviso" };
    }
    return {
      ok: false,
      error: "demasiado rapido",
      retryInSeconds: secondsToNextBucket(now, bucket, TEST_PUSH_COOLDOWN_MS),
    };
  }

  const result = await sendToUser(db, secrets, userId, {
    title: "MiCasa: aviso de prueba",
    body: "Si lees esto, los avisos de verdad te llegaran con el movil bloqueado.",
    data: { type: "test", id: userId, url: "/" },
  });

  // La reserva se queda puesta si no se pudo ni leer la lista: soltarla dejaría el
  // botón reintentable en bucle con un motivo falso en la cara.
  if (result.readFailed) {
    return { ok: false, error: "no se pudieron leer tus suscripciones" };
  }

  if (result.delivered === 0) {
    // Aquí sí se libera: la lista se leyó bien y está vacía de verdad, y el botón lo
    // pulsa una persona que puede activar el push en otro momento. Un reintento
    // inmediato no tiene por qué esperar 5 minutos.
    await db
      .from("push_log")
      .delete()
      .eq("user_id", userId)
      .eq("dedupe_key", `test:${userId}:${bucket}`);
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

/** Libera una reserva de `push_log` para que un reintento no espere al día siguiente. */
async function releaseClaim(db: Db, userId: string, key: string): Promise<void> {
  await db.from("push_log").delete().eq("user_id", userId).eq("dedupe_key", key);
}

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
 */
const NOW_PUSH_COOLDOWN_MS = 60_000;

async function runNowPush(
  db: Db,
  secrets: PushSecrets,
  userId: string,
  params: URLSearchParams,
  now: number,
): Promise<{ body: Record<string, unknown>; status: number }> {
  const fail = (error: string, status: number) => ({ body: { ok: false, error }, status });

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
    console.error("send-web-push: no se pudieron leer las preferencias", prefsError);
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
      console.error("send-web-push: no se pudo leer la cita", error);
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
      console.error("send-web-push: no se pudo leer el contacto", error);
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
  // error: el cliente solo lo llama cuando el usuario eligió un recordatorio.
  if (!dispatch) return fail("no hay recordatorio que confirmar", 404);

  const bucket = Math.floor(now / NOW_PUSH_COOLDOWN_MS);
  const retryInSeconds = secondsToNextBucket(now, bucket, NOW_PUSH_COOLDOWN_MS);
  const key = nowDedupeKey(userId, bucket);
  const { error: claimError } = await db
    .from("push_log")
    .insert({ user_id: userId, dedupe_key: key });

  if (claimError) {
    // 23505 = esta confirmación ya salió en este bucket. Se responde con ok porque
    // el efecto pedido está cubierto o no se puede cumplir y se reintenta luego: el
    // cliente no tiene nada que reintentar. Con el bucket por usuario, además, este
    // es el camino que corta el bucle de "no tengo suscripciones", sin tener que
    // soltar la reserva entre vuelta y vuelta.
    if (claimError.code === "23505") {
      return { body: { ok: true, delivered: 0, skipped: true, retryInSeconds }, status: 200 };
    }
    // Cualquier otro error es de la base de datos, no una duplicidad. Aquí sí se
    // aborta: seguir significaría enviar sin haber reservado nada, que es el
    // duplicado que `push_log` existe para evitar.
    console.error("send-web-push: no se pudo reservar la confirmacion", claimError);
    return fail("no se pudo registrar el aviso", 500);
  }

  try {
    const result = await sendToUser(db, secrets, userId, {
      title: dispatch.title,
      body: dispatch.body,
      data: { type: dispatch.type, id: dispatch.refId, url: dispatch.url },
    });

    if (result.readFailed) {
      // La reserva se queda: no sabemos si había a quién avisar, y soltarla
      // devolvería el bucle con un motivo falso en cada vuelta.
      return fail("no se pudieron leer tus suscripciones", 500);
    }

    if (result.delivered === 0) {
      // Nadie lo recibió (típicamente: sin suscripciones en este navegador). La
      // reserva NO se suelta: es ella la que hace de enfriamiento. Soltarla era lo
      // que dejaba el bucle abierto, porque el siguiente request volvía a reservar
      // la misma clave y a pagar otra vez la validación de sesión, las dos llamadas
      // a Vault y las consultas de casas, citas y suscripciones.
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
    // un fallo inesperado. Aun así, la reserva se suelta: una fila puesta por un
    // envío que no ocurrió bloquearía el reintento y ocuparía una fila para siempre.
    console.error("send-web-push: fallo en el aviso de confirmacion", error);
    await releaseClaim(db, userId, key);
    return fail("no se pudo enviar el aviso", 500);
  }
}

/** Reparte y envía todos los recordatorios pendientes. */
async function runDispatch(db: Db, secrets: PushSecrets, now: number): Promise<Record<string, unknown>> {
  const instante = new Date(now);
  const windowStart = new Date(instante.getTime() - CATCHUP_MINUTES * 60_000);

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
    console.error("send-web-push: no se pudieron leer las suscripciones", subsError);
    return { ok: false, error: "fallo al leer suscripciones" };
  }

  const groups = groupByUserAndTimezone((subs ?? []) as SubscriptionRow[]);
  const dispatches = await buildDispatches(db, groups, instante, windowStart);

  if (dispatches.length === 0) {
    return { ok: true, dispatched: 0, sent: 0, skipped: 0, window: CATCHUP_MINUTES };
  }

  let sent = 0;
  let skipped = 0;
  const dead: string[] = [];
  const failures: { id: string; count: number; inactive: boolean }[] = [];

  for (const dispatch of dispatches) {
    const key = dedupeKey(dispatch);

    // Idempotencia: solo envía la ejecución que gana la restricción de unicidad.
    const { error: claimError } = await db
      .from("push_log")
      .insert({ user_id: dispatch.userId, dedupe_key: key });

    if (claimError) {
      // 23505 = clave duplicada: otra ejecución ya lo envió.
      if (claimError.code === "23505") {
        skipped++;
        continue;
      }
      console.error("send-web-push: no se pudo reservar el envio", claimError);
      continue;
    }

    const group = groups.find((g) => g.userId === dispatch.userId && g.timezone === dispatch.timezone);
    let delivered = 0;

    for (const sub of group?.subs ?? []) {
      try {
        await webpush.sendNotification(
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
        await db
          .from("push_subscriptions")
          .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
          .eq("id", sub.id);
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // El navegador se dio de baja o el servicio caducó el endpoint.
          dead.push(sub.id);
          continue;
        }
        if (isUnusableSubscription(error)) {
          // Las claves no sirven y no van a servirlas nunca: no tiene sentido
          //dejarlo para el próximo intento ni contar un fallo más.
          dead.push(sub.id);
          continue;
        }
        const count = (sub.failure_count ?? 0) + 1;
        failures.push({ id: sub.id, count, inactive: count >= MAX_FAILURES });
      }
    }

    if (delivered > 0) {
      sent++;
    } else if ((group?.subs.length ?? 0) > 0) {
      // El aviso se reservó pero nadie lo recibió: se libera la reserva para
      // que otra ejecución pueda reintentar dentro de la ventana.
      await db.from("push_log").delete().eq("user_id", dispatch.userId).eq("dedupe_key", key);
    }
  }

  if (dead.length > 0) await db.from("push_subscriptions").delete().in("id", dead);
  for (const failure of failures) {
    await db
      .from("push_subscriptions")
      .update({ failure_count: failure.count, active: !failure.inactive })
      .eq("id", failure.id);
  }

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
 * `deps` inyecta el cliente de Supabase y el reloj. Los tests lo necesitan: sin un
 * doble de base de datos no hay forma de comprobar qué consulta sale cuando una
 * falla, y sin un reloj fijo el bucket de enfriamiento depende del instante en que
 * el test corre. En producción no se pasa nada y se usan los de verdad.
 */
export async function handle(
  req: Request,
  env: EnvReader = Deno.env,
  deps: HandlerDeps = {},
): Promise<Response> {
  // Si `WEB_PUSH_ALLOWED_ORIGINS` está definida, su lista sustituye a la de por
  // defecto (ver `resolveAllowedOrigins`).
  const allowedOrigins = resolveAllowedOrigins(env.get("WEB_PUSH_ALLOWED_ORIGINS"));
  const origin = req.headers.get("origin");

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
      const result = await runNowPush(db, userSecrets, userId, new URL(req.url).searchParams, clock());
      return json(result.body, result.status);
    }

    return json(await runTestPush(db, userSecrets, userId, clock()));
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
    return json(await runDispatch(db, secrets, clock()));
  }

  // pg_net aborta la llamada a los 5 s, y el arranque en frío de la función ya
  // consume más que eso. Por eso el cron solo encola: el trabajo real sigue en
  // segundo plano con waitUntil. `?sync=1` existe para depurar a mano.
  EdgeRuntime.waitUntil(
    runDispatch(db, secrets, clock()).catch((error) => {
      console.error("send-web-push: fallo en el reparto", error);
    }),
  );
  return json({ ok: true, queued: true }, 202);
}
