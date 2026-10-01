/**
 * Lógica pura de recordatorios de la Edge Function `send-web-push`.
 *
 * Sin I/O: solo fechas, zonas horarias y texto. Así se puede testear con
 * `deno test` sin tocar Supabase ni la red. Por eso este fichero NO importa nada
 * de `@supabase/supabase-js`: leer una fila es trabajo de `handler.ts`, y aquí solo
 * entra lo que se puede comprobar sin base de datos.
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
 * ¿Es un identificador de zona horaria que `Intl` entiende?
 *
 * La zona llega del cliente, así que no se puede confiar en ella. Un valor basura no
 * revienta (los formateadores ya devuelven "" ante una zona inválida), pero sí
 * haría que el texto saliera sin fecha o con una fecha equivocada, y el usuario
 * leería un aviso que no cuadra. Mejor rechazarla y usar la zona de su suscripción.
 *
 * El tope de 64 caracteres no es arbitrario: es el `check` de la columna
 * `push_subscriptions.timezone`, y por tanto el peor caso que puede venir de
 * nuestra propia base de datos.
 */
export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== "string" || timeZone.length === 0 || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Instancia UTC que en la zona `timeZone` son las 09:00 del día local indicado.
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

/**
 * Una fila de `push_preferences`. `birthday_choice` se modela como `string` y no
 * como `ReminderChoice` a propósito: lo que viene de la base no está garantizado,
 * y la función que lo lee tiene que poder mirar un valor ilegible sin que el
 * compilador lo llame imposible. Valida con `isValidChoice`.
 */
export interface PushPreference {
  enabled: boolean;
  birthday_choice?: string | null;
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

/**
 * Cuándo avisa de cumpleaños, a partir de la fila de preferencias.
 *
 * Sin fila, o con un valor que no es de la lista, devuelve "none": quien no sabe
 * no avisa. Antes devolvía "both", y eso dejaba al servidor y a la pantalla
 * diciendo cosas distintas en el mismo caso: con la fila ausente, Ajustes pintaba
 * "sin aviso" y el servidor mandaba los dos avisos. El repliegue que arriesga
 * menos es el que no manda nada, y una fila ausente solo se da si nadie ha
 * pasado por Ajustes con el push activo o si se borró a mano.
 *
 * La asimetría con `isPushEnabled` es deliberada: el interruptor maestro asume
 * activado sin fila porque llegar al dispatcher ya implica una suscripción viva,
 * o sea un consentimiento previo. Para el *qué* de los cumpleaños no hay ninguna
 * señal de ese tipo, así que se asume lo mínimo.
 */
export function birthdayChoiceFor(pref: PushPreference | null | undefined): ReminderChoice {
  return isValidChoice(pref?.birthday_choice) ? pref.birthday_choice : "none";
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
 *
 * La comparación va por `dayInYear` y no por una igualdad de mes-día, y esa es la
 * diferencia que hace que los cumpleaños del 29 de febrero se avisen. Comparando
 * mes-día, la fecha 02-29 no llega a existir como día real en un año que no es
 * bisiesto y el aviso no salía nunca; normalizando, esos cumpleaños caen el 1 de
 * marzo, que es el día que les toca. Es un cambio de comportamiento deliberado:
 * antes de esto, un contacto nacido el 29/02 no recibía ningún aviso en los años
 * no bisiestos, y con esto sí. La misma convención usa la app y `nextBirthdayDay`.
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
    if (!isMonthDay(monthDay)) continue;

    for (const candidate of candidatesFor(today, choice)) {
      if (dayInYear(Number(candidate.eventDay.slice(0, 4)), monthDay) !== candidate.eventDay) continue;

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

/**
 * Avisa de confirmación del modo `now`: el usuario acaba de crear una cita o un
 * cumpleaños y la función le confirma que el recordatorio queda anotado.
 *
 * Deliberadamente NO es un `Dispatch`: no lleva `slot` ni `localDay` porque no es
 * un recordatorio. No salta el día antes ni el mismo día, salta ahora, y por eso
 * tampoco puede compartir la clave de idempotencia del cron (ver `nowDedupeKey`).
 */
export interface NowDispatch {
  type: ReminderType;
  refId: string;
  title: string;
  body: string;
  url: string;
}

/** Cómo se cuenta en español lo que va a avisar, según la preferencia. */
const CHOICE_PHRASE: Record<Exclude<ReminderChoice, "none">, string> = {
  "day-before": "Te avisaremos el día antes.",
  "same-day": "Te avisaremos el mismo día.",
  both: "Te avisaremos el día antes y el mismo día.",
};

/**
 * "12 de marzo a las 10:00" / "12 de marzo", o "" si la zona no es válida.
 * Se usa para que la confirmación diga la fecha REAL del evento: el texto no puede
 * decir "mañana" si el cumpleaños es dentro de tres meses.
 */
export function formatWhen(instant: Date | string, timeZone: string): string {
  const day = formatDayMonth(instant, timeZone);
  if (day.length === 0) return "";
  const time = formatTime(instant, timeZone);
  return time.length > 0 ? `${day} a las ${time}` : day;
}

/** "10 de mayo". Devuelve "" si la zona horaria no la entiende `Intl`. */
export function formatDayMonth(instant: Date | string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("es-ES", {
      timeZone,
      day: "numeric",
      month: "long",
    }).format(new Date(instant));
  } catch {
    return "";
  }
}

const MONTH_NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/**
 * "5 de octubre" a partir de un día `YYYY-MM-DD`.
 *
 * Sin zona horaria y a propósito, porque un cumpleaños es un día del calendario, no
 * un instante. Formatearlo como instante desplazaba el texto de dos maneras: a las
 * 00:00Z en Madrid salía "5 de octubre a las 02:00" (una hora que el cumpleaños no
 * tiene), y en cualquier zona al este de UTC+12 el día se corría al siguiente. El
 * texto acaba en la notificación del móvil de alguien, y decir "mañana" o una hora
 * que no existe es peor que no decir fecha.
 */
export function formatMonthDay(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  const month = Number(day.slice(5, 7)) - 1;
  const name = MONTH_NAMES[month];
  if (name === undefined) return "";
  return `${Number(day.slice(8, 10))} de ${name}`;
}

/** "2026-03-01" a partir de un `Date` en UTC. */
function toIsoDay(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${month}-${day}`;
}

/**
 * La fecha que ocupa un mes-día en el calendario de `year`, o sea con la
 * normalización de `Date`: el 29 de febrero sigue siendo el 29 en un año bisiesto y
 * cae el 1 de marzo en los que no lo son.
 *
 * Esa normalización ES la convención, no un accidente: es lo mismo que hace la app
 * con `new Date(año, 1, 29)`, así que un 29/02 avisa el 1 de marzo en vez de
 * desaparecer hasta el siguiente año bisiesto. Antes esta Edge saltaba al próximo
 * bisiesto (2028) y la app agendaba el 1 de marzo de 2027: el push de confirmación
 * decía una cosa y el aviso de verdad salía otro día, o nunca.
 *
 * El año se fija con `setUTCFullYear` y no con el argumento de `Date.UTC` porque
 * ese argumento interpreta los años de dos cifras como 19xx: un año 0095 salía
 * 1995, que es un cumpleaños inventado a 1900 años vista.
 */
function dayInYear(year: number, monthDay: string): string {
  const probe = new Date(Date.UTC(2000, Number(monthDay.slice(0, 2)) - 1, Number(monthDay.slice(3, 5))));
  probe.setUTCFullYear(year);
  return toIsoDay(probe);
}

/** ¿El mes-día tiene forma de mes-día y cabe en un mes? No comprueba el año. */
function isMonthDay(monthDay: string): boolean {
  if (!/^\d{2}-\d{2}$/.test(monthDay)) return false;
  const month = Number(monthDay.slice(0, 2));
  const day = Number(monthDay.slice(3, 5));
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/**
 * La siguiente fecha (YYYY-MM-DD) en la que se cumple el mes y día de `birthDate`,
 * a partir de `today` incluida.
 *
 * Con la normalización de `dayInYear`, un 29 de febrero se cumple el 1 de marzo de
 * los años que no lo tienen, que es la fecha que usa la app (ver
 * `src/lib/birthdays.ts`). Solo se prueban este año y el siguiente porque la
 * normalización nunca mueve la fecha hacia atrás de enero: con eso basta, y así es
 * imposible devolver algo pasado por haber buscado un año de más.
 *
 * La fecha de nacimiento sí tiene que existir en su propio año: un 30 de febrero no
 * existe en ninguno y un 29/02 de un año que no lo tiene no es un cumpleaños que la
 * app pueda enseñar (`safeDate` lo descarta). Normalizar en silencio esos casos
 * inventaría una fecha que el cliente nunca muestra.
 */
export function nextBirthdayDay(birthDate: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const monthDay = birthDate.slice(5, 10);
  if (!isMonthDay(monthDay)) return null;
  if (dayInYear(Number(birthDate.slice(0, 4)), monthDay) !== birthDate) return null;

  const startYear = Number(today.slice(0, 4));

  for (let year = startYear; year <= startYear + 1; year++) {
    const candidate = dayInYear(year, monthDay);
    // Cadenas "YYYY-MM-DD": ordenan igual que cronológicamente.
    if (candidate >= today) return candidate;
  }
  return null;
}

/**
 * Última frase del cuerpo: cuándo es y qué va a pasar.
 *
 * `when` llega ya formateado porque una cita es un instante (día y hora) y un
 * cumpleaños es solo un día del calendario, y los dos no se pueden tratar igual: ver
 * `formatWhen` y `formatMonthDay`.
 */
function confirmationBody(when: string, choice: Exclude<ReminderChoice, "none">): string {
  const lead = when.length > 0 ? `Es el ${when}. ` : "";
  return truncate(`${lead}${CHOICE_PHRASE[choice]}`);
}

/**
 * Confirmación de una cita recién creada. `null` si no hay recordatorio que
 * confirmar, que para el llamador es un 404 y no un error.
 */
export function buildNowAppointmentDispatch(input: {
  refId: string;
  title: string;
  startsAt: string;
  choice: ReminderChoice;
  timeZone: string;
}): NowDispatch | null {
  if (input.choice === "none") return null;
  return {
    type: "appointment",
    refId: input.refId,
    title: `Cita: ${truncate(input.title, 60)}`,
    body: confirmationBody(formatWhen(input.startsAt, input.timeZone), input.choice),
    url: "/citas",
  };
}

/**
 * Confirmación de un cumpleaños recién creado. `null` si no hay recordatorio que
 * confirmar.
 *
 * No lleva `timeZone` a propósito, y no es un descuido: un cumpleaños es un día del
 * calendario, así que la fecha se formatea sin zona (ver `formatMonthDay`). Si se
 * aceptara una zona, el texto dependería de ella sin motivo.
 *
 * A diferencia del recordatorio del cron, esta función NO exige que el cumpleaños
 * caiga hoy o mañana. La fecha se resuelve hacia adelante, así que un contacto
 * creado con un cumpleaños dentro de tres meses también se confirma, diciendo la
 * fecha de verdad. Antes solo se construía el aviso si el cumpleaños caía en la
 * ventana de día antes / mismo día, lo que dejaba esta función sin efecto en el
 * caso normal de uso.
 */
export function buildNowBirthdayDispatch(input: {
  refId: string;
  name: string;
  birthDate: string | null;
  choice: ReminderChoice;
  today: string;
}): NowDispatch | null {
  if (input.choice === "none") return null;
  const next = input.birthDate ? nextBirthdayDay(input.birthDate, input.today) : null;
  if (next === null) return null;
  return {
    type: "birthday",
    refId: input.refId,
    title: `Cumpleaños: ${truncate(input.name, 60)}`,
    body: confirmationBody(formatMonthDay(next), input.choice),
    url: "/cumpleanos",
  };
}

/**
 * Clave de idempotencia del modo `now`, en un espacio de nombres PROPIO.
 *
 * El prefijo `now:` no es decorativo: `dedupeKey` devuelve
 * `${type}:${refId}:${slot}:${localDay}`, que es exactamente la fila que el cron
 * inserta para el recordatorio real. Si las dos compartieran clave, la
 * confirmación se comería el recordatorio, y el usuario se quedaría sin el aviso
 * que le importa a cambio del que solo le confirma lo que acaba de hacer.
 *
 * El bucket va por USUARIO y no por referencia, y es lo que frena el bucle: lo que
 * hay que impedir son peticiones repetidas sin nada que entregar (cada una cuesta
 * una validación de sesión, dos llamadas a Vault y varias consultas), no dos avisos
 * del mismo evento. `bucket` viene del reloj del llamador, no de aquí, para que este
 * módulo siga sin leer la hora.
 *
 * Lo que la fila significa, escrito aquí para que no se lea de otra manera: NO es
 * "esta referencia quedó confirmada", es "este usuario pidió una confirmación dentro
 * de este minuto". La reserva se pide antes de validar el tipo, el id y antes de
 * consultar nada (ver `runNowPush`), así que hasta un `id` que no existe deja fila.
 *
 * El canje de ese espacio de nombres por usuario es deliberado y tiene un precio
 * concreto: guardar un cumpleaños y una cita dentro del mismo minuto hace que la
 * SEGUNDA respuesta sea "omitida" sin mandar push, porque la clave ya está ocupada.
 * Es aceptable porque los dos call sites hacen fire-and-forget e ignoran el
 * retorno —la UI no se entera—, y porque el caso real es una persona creando una
 * cosa y guardando la otra un momento después. Con la clave por referencia, el
 * bucle volvería a entrar por la vía de un `id` que no existe.
 */
export function nowDedupeKey(userId: string, bucket: number): string {
  return `now:${userId}:${bucket}`;
}

/** Fin de la ventana de consulta de citas: hoy más el horizonte. */
export function appointmentQueryUpperBound(now: Date): Date {
  return new Date(now.getTime() + APPOINTMENT_HORIZON_DAYS * 86_400_000);
}
