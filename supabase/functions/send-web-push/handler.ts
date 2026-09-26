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
  buildAppointmentDispatches,
  buildBirthdayDispatches,
  dedupeKey,
  isPushEnabled,
  isValidChoice,
  type AppointmentRow,
  type ContactRow,
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

/**
 * Casas de las que el usuario sigue siendo miembro. Alguien expulsado de una
 * casa conserva sus filas en `appointments` (solo se borra su `casa_members`),
 * así que sin este filtro seguiría recibiendo los títulos y horas de las citas
 * de esa casa por push, aunque la UI ya no se las muestra.
 */
async function fetchCasaIds(db: Db, userId: string): Promise<string[]> {
  const { data, error } = await db
    .from("casa_members")
    .select("casa_id")
    .eq("user_id", userId);

  if (error) {
    console.error("send-web-push: no se pudieron leer las casas del usuario", error);
    return [];
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
): Promise<AppointmentRow[]> {
  if (casaIds.length === 0) return [];

  const { data, error } = await db
    .from("appointments")
    .select("id, title, starts_at, reminder_choice")
    .eq("user_id", userId)
    .in("casa_id", casaIds)
    .in("reminder_choice", ["day-before", "same-day", "both"])
    .gte("starts_at", from.toISOString())
    .lte("starts_at", appointmentQueryUpperBound(now).toISOString());

  if (error) console.error("send-web-push: no se pudieron leer las citas", error);
  return (data ?? []) as AppointmentRow[];
}

/** Contactos con fecha de nacimiento de todas las casas del usuario. */
async function fetchBirthdayContacts(db: Db, casaIds: string[]): Promise<ContactRow[]> {
  if (casaIds.length === 0) return [];

  const { data, error } = await db
    .from("contacts")
    .select("id, name, birth_date")
    .in("casa_id", casaIds)
    .not("birth_date", "is", null);

  if (error) console.error("send-web-push: no se pudieron leer los contactos", error);
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

    const pref = (prefs ?? null) as { birthday_choice: string; enabled: boolean } | null;
    if (!isPushEnabled(pref)) continue;

    const casaIds = await fetchCasaIds(db, group.userId);
    if (casaIds.length === 0) continue;

    const appointments = await fetchAppointments(db, group.userId, casaIds, now, from);
    out.push(...buildAppointmentDispatches(appointments, context).map((d) => ({ ...d, ...target })));

    const choice = isValidChoice(pref?.birthday_choice) ? pref.birthday_choice : "both";
    if (choice !== "none") {
      const contacts = await fetchBirthdayContacts(db, casaIds);
      out.push(...buildBirthdayDispatches(contacts, choice, context).map((d) => ({ ...d, ...target })));
    }
  }

  return out;
}

/** Envía un payload ya construido a las suscripciones de un usuario. */
async function sendToUser(
  db: Db,
  secrets: PushSecrets,
  userId: string,
  payload: { title: string; body: string; tag: string; url: string },
): Promise<{ delivered: number; removed: number }> {
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
    return { delivered: 0, removed: 0 };
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
          tag: payload.tag,
          renotify: true,
          data: { type: "test", url: payload.url },
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
      if (status === 404 || status === 410) {
        dead.push(sub.id);
        continue;
      }
      console.error("send-web-push: fallo enviando el aviso de prueba", error);
    }
  }

  if (dead.length > 0) await db.from("push_subscriptions").delete().in("id", dead);
  return { delivered, removed: dead.length };
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
): Promise<Record<string, unknown>> {
  const bucket = Math.floor(Date.now() / TEST_PUSH_COOLDOWN_MS);
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
      retryInSeconds: Math.ceil(
        ((bucket + 1) * TEST_PUSH_COOLDOWN_MS - Date.now()) / 1000,
      ),
    };
  }

  const result = await sendToUser(db, secrets, userId, {
    title: "MiCasa: aviso de prueba",
    body: "Si lees esto, los avisos de verdad te llegaran con el movil bloqueado.",
    tag: `test:${userId}`,
    url: "/",
  });

  if (result.delivered === 0) {
    // Se libera la reserva para que un reintento inmediato no espere 5 minutos.
    await db
      .from("push_log")
      .delete()
      .eq("user_id", userId)
      .eq("dedupe_key", `test:${userId}:${bucket}`);
    return { ok: false, error: "sin suscripciones activas en este navegador" };
  }

  return { ok: true, delivered: result.delivered, removedSubscriptions: result.removed };
}

/** Reparte y envía todos los recordatorios pendientes. */
async function runDispatch(db: Db, secrets: PushSecrets): Promise<Record<string, unknown>> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - CATCHUP_MINUTES * 60_000);

  const { data: subs, error: subsError } = await db
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth, timezone, failure_count")
    .eq("active", true);

  if (subsError) {
    console.error("send-web-push: no se pudieron leer las suscripciones", subsError);
    return { ok: false, error: "fallo al leer suscripciones" };
  }

  const groups = groupByUserAndTimezone((subs ?? []) as SubscriptionRow[]);
  const dispatches = await buildDispatches(db, groups, now, windowStart);

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

  await db
    .from("push_log")
    .delete()
    .lt("sent_at", new Date(now.getTime() - LOG_RETENTION_DAYS * 86_400_000).toISOString());

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
 */
export async function handle(req: Request, env: EnvReader = Deno.env): Promise<Response> {
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

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const subject = env.get("VAPID_SUBJECT") ?? DEFAULT_VAPID_SUBJECT;

  // Aviso de prueba: lo pide el usuario con su propia sesión, no el dispatcher.
  //
  // Esta rama va ANTES del gate del secreto del cron, y no por descuido: ese
  // gate protege al dispatcher, que tiene alcance global, y el aviso de prueba
  // no lo tiene porque solo puede avisar a quien se acaba de autenticar. Con el
  // gate delante, el botón de Ajustes no tenía forma de mandar el secreto (no
  // debe viajar en un bundle) y respondía 401 siempre: estaba muerto.
  //
  // El orden que sí importa es otro: primero se valida la sesión y solo después
  // se leen las claves VAPID de Vault, para que una petición sin sesión válida
  // no llegue a tocar ningún secreto.
  if (new URL(req.url).searchParams.get("mode") === "test") {
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (token.length === 0) return json({ error: "falta la sesion" }, 401);

    const { data: userData, error: userError } = await db.auth.getUser(token);
    if (userError || !userData?.user) return json({ error: "sesion no valida" }, 401);

    const testVapid = await readVapidKeys(db, env);
    if (!testVapid) return json({ error: "no autorizado" }, 401);

    // `cronSecret` vacío a propósito: este camino no lo usa, y así no se
    // construye un valor que luego se lee sin querer.
    return json(await runTestPush(db, { cronSecret: "", subject, ...testVapid }, userData.user.id));
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
    return json(await runDispatch(db, secrets));
  }

  // pg_net aborta la llamada a los 5 s, y el arranque en frío de la función ya
  // consume más que eso. Por eso el cron solo encola: el trabajo real sigue en
  // segundo plano con waitUntil. `?sync=1` existe para depurar a mano.
  EdgeRuntime.waitUntil(
    runDispatch(db, secrets).catch((error) => {
      console.error("send-web-push: fallo en el reparto", error);
    }),
  );
  return json({ ok: true, queued: true }, 202);
}
