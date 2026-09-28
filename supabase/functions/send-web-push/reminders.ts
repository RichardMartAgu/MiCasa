/**
 * Lógica pura de recordatorios de la Edge Function `send-web-push`.
 *
 * Sin I/O: solo fechas, zonas horarias y texto. Así se puede testear con
 * `deno test` sin tocar Supabase ni la red.
 *
 * Es el espejo de `src/lib/notification-schedule.ts` de la app: mismos horarios
 * (09:00 local) y mismos slots (día antes / mismo día). Si cambia uno, cambia el
 * otro, y ambos tienen sus tests.
 */

export type ReminderChoice = "none" | "day-before" | "same-day" | "both";
export type Slot = "day-before" | "same-day";
export type ReminderType = "appointment" | "birthday";

export interface Dispatch {
  type: ReminderType;
  refId: string;
  slot: Slot;
  /** Día local (YYYY-MM-DD) para el que se emite el aviso. */
  localDay: string;
  title: string;
  body: string;
  url: string;
}

/** Un aviso ya asociado al destinatario concreto que lo va a recibir. */
export interface TargetedDispatch extends Dispatch {
  userId: string;
  timezone: string;
}

export interface AppointmentRow {
  id: string;
  title: string;
  starts_at: string;
  reminder_choice: string;
}

export interface ContactRow {
  id: string;
  name: string;
  birth_date: string | null;
}

export const REMINDER_HOUR = 9;

/** Número de días que se avisan por adelantado como máximo. */
const APPOINTMENT_HORIZON_DAYS = 8;

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let code = from; code < to; code++) out.push(code);
  return out;
}

export function isValidChoice(value: unknown): value is ReminderChoice {
  return value === "none" || value === "day-before" || value === "same-day" || value === "both";
}

export function addDays(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** Fecha local (YYYY-MM-DD) del instante `now` en la zona `timeZone`. */
export function localDayUtc(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Desplazamiento de la zona respecto a UTC (en ms) en un instante dado.
 * Positivo hacia el este. null si la zona no es válida.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number | null {
  try {
    const probe = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    // formatToParts no da milisegundos: se trunca el instante para no desviar.
    const truncated = Math.floor(instant.getTime() / 1000) * 1000;
    const parts = Object.fromEntries(
      probe.formatToParts(new Date(truncated)).map((p) => [p.type, p.value]),
    );
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour === "24" ? "00" : parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    return asUtc - truncated;
  } catch {
    return null;
  }
}

/**
 * Instante UTC que en la zona `timeZone` son las 09:00 del día local indicado.
 * Devuelve null si la zona no es válida.
 */
export function nineAmUtc(localDay: string, timeZone: string): Date | null {
  // Ancla: las 00:00 del día local expresadas como si fuera UTC.
  const anchor = Date.parse(`${localDay}T00:00:00Z`);
  if (Number.isNaN(anchor)) return null;

  // La medianoche local no es el ancla menos el offset, porque el ancla ya está
  // en UTC: se corrige con el desplazamiento de la zona. Se itera dos veces
  // para cubrir cambios de horario de verano dentro del mismo día.
  let instant = anchor;
  for (let i = 0; i < 2; i++) {
    const offset = zoneOffsetMs(new Date(instant), timeZone);
    if (offset === null) return null;
    instant = anchor - offset + REMINDER_HOUR * 3_600_000;
  }
  return new Date(instant);
}

export interface Candidate {
  /** Día local del evento (cita o cumpleaños) al que se refiere el aviso. */
  eventDay: string;
  slot: Slot;
  /** Día local en el que salta el aviso a las 09:00. */
  fireDay: string;
}

/**
 * Los únicos avisos que pueden saltar hoy, según la preferencia:
 *
 * - "día antes": el evento es mañana y el aviso sale hoy.
 * - "mismo día": el evento es hoy y el aviso sale hoy a las 09:00.
 *
 * Cualquier otro caso pertenece a otro día y lo cubre esa otra ejecución.
 */
export function candidatesFor(today: string, choice: ReminderChoice): Candidate[] {
  const out: Candidate[] = [];
  if (choice === "day-before" || choice === "both") {
    out.push({ eventDay: addDays(today, 1), slot: "day-before", fireDay: today });
  }
  if (choice === "same-day" || choice === "both") {
    out.push({ eventDay: today, slot: "same-day", fireDay: today });
  }
  return out;
}

/** ¿El instante cae en ese día local? Compara por fecha, no por hora. */
export function fallsOnLocalDay(instant: Date | string, localDay: string, timeZone: string): boolean {
  try {
    return localDayUtc(new Date(instant), timeZone) === localDay;
  } catch {
    return false;
  }
}

export function formatTime(instant: Date | string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("es-ES", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(instant));
  } catch {
    return "";
  }
}

// Rangos escritos con range() y no con escapes \u en el literal: un pegado del
// fichero con caracteres literales rompería el fuente, y ya pasó.
const BIDI_CODEPOINTS = [
  0x061c, // marca de dirección árabe
  ...range(0x200b, 0x2010), // ancho cero y marcas de dirección
  ...range(0x202a, 0x202f), // emparejamiento bidireccional
  ...range(0x2060, 0x206a), // marcas invisibles
  ...range(0x2028, 0x202a), // separadores de línea y párrafo
  0xfeff, // BOM
];
const CONTROL_CODEPOINTS = [...range(0x00, 0x20), ...range(0x7f, 0xa0)];
function charClass(codepoints: number[]): RegExp {
  const escapes = codepoints.map((code) => `\\u${code.toString(16).padStart(4, "0")}`).join("");
  return new RegExp(`[${escapes}]`, "g");
}

const BIDI_MARKS = charClass(BIDI_CODEPOINTS);
const CONTROL_CHARS = charClass(CONTROL_CODEPOINTS);

/**
 * Quita caracteres de control y marcas de dirección bidireccional. El texto de
 * una cita o el nombre de un contacto los puede escribir cualquier miembro de
 * una casa compartida, y un U+202E (RLO) invertido puede hacer que el aviso
 * parezca algo distinto de lo que es. Las notificaciones no interpretan HTML,
 * pero sí muestran texto, así que el engaño visual sí es posible.
 *
 * Los controles se cambian por un espacio para no pegar dos palabras, y los
 * espacios repetidos se colapsan.
 */
// Marcas de dirección bidireccional y de ancho cero: se eliminan, no estorban.
// Controles C0/C1: un salto de línea o un tabulador se convierten en espacio para
// no pegar dos palabras, y luego se colapsan los espacios repetidos.

export function sanitizeText(input: string): string {
  return input
    .replace(BIDI_MARKS, "")
    .replace(CONTROL_CHARS, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

/**
 * Recorta el texto para que quepa en el cuerpo de una notificación móvil: la
 * mayoría de navegadores muestran solo un par de líneas.
 */
export function truncate(input: string, max = 110): string {
  const clean = sanitizeText(input);
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

export interface PushPreference {
  enabled: boolean;
}

/**
 * Interruptor maestro de los avisos. Sin fila de preferencias se asume activado:
 * llegar al dispatcher ya significa que hay una suscripción activa, o sea que el
 * usuarioconsentió en su momento.
 *
 * Se comprueba antes de generar nada, y no solo para los cumpleaños: con el corte
 * puesto solo en los cumpleaños, apagar el interruptor dejaba las citas llegando
 * igual, que es un fallo de consentimiento y no de lógica.
 */
export function isPushEnabled(pref: PushPreference | null | undefined): boolean {
  if (!pref) return true;
  return pref.enabled !== false;
}

export interface Window {
  /** Instante más antiguo que se considera "pendiente de enviar". */
  from: Date;
  /** Instante más nuevo que se considera pendiente. */
  to: Date;
}

export interface Context {
  now: Date;
  timeZone: string;
  window: Window;
}

function withinWindow(fireAt: Date, window: Window): boolean {
  return fireAt >= window.from && fireAt <= window.to;
}

/**
 * Recordatorios de citas. Se avisaba al usuario que creó la cita
 * (`appointments.user_id`), que es quien eligió `reminder_choice`.
 */
export function buildAppointmentDispatches(
  appointments: AppointmentRow[],
  context: Context,
): Dispatch[] {
  const out: Dispatch[] = [];
  const today = localDayUtc(context.now, context.timeZone);

  for (const appointment of appointments) {
    const choice = isValidChoice(appointment.reminder_choice)
      ? appointment.reminder_choice
      : "none";
    if (choice === "none") continue;

    for (const candidate of candidatesFor(today, choice)) {
      if (!fallsOnLocalDay(appointment.starts_at, candidate.eventDay, context.timeZone)) continue;

      const fireAt = nineAmUtc(candidate.fireDay, context.timeZone);
      if (!fireAt || !withinWindow(fireAt, context.window)) continue;

      const time = formatTime(appointment.starts_at, context.timeZone);
      out.push({
        type: "appointment",
        refId: appointment.id,
        slot: candidate.slot,
        localDay: candidate.fireDay,
        title: `Cita ${candidate.slot === "day-before" ? "mañana" : "hoy"}: ${
          truncate(appointment.title, 60)
        }`,
        body: truncate(time ? `${appointment.title} a las ${time}.` : appointment.title),
        url: "/citas",
      });
    }
  }
  return out;
}

/**
 * Recordatorios de cumpleaños. Se compara el mes y el día del cumpleaños con el día
 * local del evento, igual que el día local de una cita, de modo que ambos
 * comparten la misma noción de "mañana" y "hoy".
 */
export function buildBirthdayDispatches(
  contacts: ContactRow[],
  choice: ReminderChoice,
  context: Context,
): Dispatch[] {
  const out: Dispatch[] = [];
  if (choice === "none") return out;

  const today = localDayUtc(context.now, context.timeZone);

  for (const contact of contacts) {
    if (!contact.birth_date) continue;
    const monthDay = contact.birth_date.slice(5, 10);
    if (!/^\d{2}-\d{2}$/.test(monthDay)) continue;

    for (const candidate of candidatesFor(today, choice)) {
      if (candidate.eventDay.slice(5) !== monthDay) continue;

      const fireAt = nineAmUtc(candidate.fireDay, context.timeZone);
      if (!fireAt || !withinWindow(fireAt, context.window)) continue;
      out.push({
        type: "birthday",
        refId: contact.id,
        slot: candidate.slot,
        localDay: candidate.fireDay,
        title: `Cumpleaños ${candidate.slot === "day-before" ? "mañana" : "hoy"}: ${
          truncate(contact.name, 60)
        }`,
        body: truncate(`Es el cumpleaños de ${contact.name}.`),
        url: "/cumpleanos",
      });
    }
  }
  return out;
}

/** Clave de idempotencia: un aviso por referencia, slot y día local. */
export function dedupeKey(dispatch: Dispatch): string {
  return `${dispatch.type}:${dispatch.refId}:${dispatch.slot}:${dispatch.localDay}`;
}

/** Fin de la ventana de consulta de citas: hoy más el horizonte. */
export function appointmentQueryUpperBound(now: Date): Date {
  return new Date(now.getTime() + APPOINTMENT_HORIZON_DAYS * 86_400_000);
}
