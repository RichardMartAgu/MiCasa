import { nextBirthday } from './birthdays';
import { daysBetween } from './date';
import type { Appointment, Contact, FridgeItem } from './types';

export type ReminderChoice = 'none' | 'day-before' | 'same-day' | 'both';
export type ReminderSlot = 'day-before' | 'same-day';

export const reminderChoices: readonly ReminderChoice[] = [
  'none',
  'day-before',
  'same-day',
  'both',
];

export const reminderChoiceLabels: Record<ReminderChoice, string> = {
  none: 'Sin aviso',
  'day-before': 'Día antes',
  'same-day': 'Mismo día',
  both: 'Día antes + mismo día',
};

export const REMINDER_MARGIN_MS = 60_000;

function atNine(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9, 0, 0, 0);
}

function dayBefore(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
}

function isFuture(date: Date, now: Date): boolean {
  return date.getTime() > now.getTime() + REMINDER_MARGIN_MS;
}

/**
 * Mismo saneado que aplica la Edge Function antes de enviar un push. El texto
 * puede venir de cualquier miembro de la casa y una marca de dirección
 * bidireccional puede hacer que la notificación parezca otra cosa.
 */
const BIDI_MARKS = /[\u061c\u200b-\u200f\u202a-\u202e\u2028-\u2029\u2060-\u206a\ufeff]/g;
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

export function sanitizeNotificationText(input: string): string {
  return input
    .replace(BIDI_MARKS, '')
    .replace(CONTROL_CHARS, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

export function appointmentReminderDates(
  startsAt: Date,
  choice: ReminderChoice,
  now = new Date(),
): { reminderAtRaw: string | null; triggers: Date[]; choice: ReminderChoice } {
  if (choice === 'none') return { reminderAtRaw: null, triggers: [], choice };
  const sameDay = atNine(startsAt);
  const before = atNine(dayBefore(startsAt));
  const candidates: Date[] = [];
  if (choice === 'day-before' || choice === 'both') candidates.push(before);
  if (choice === 'same-day' || choice === 'both') candidates.push(sameDay);
  const triggers = candidates.filter((date) => isFuture(date, now));
  return {
    reminderAtRaw: triggers.length > 0 ? triggers[0].toISOString() : null,
    triggers,
    choice,
  };
}

export function birthdayNotificationDates(
  birthDate: Date,
  choice: ReminderChoice,
  now: Date,
  horizonDays = 365,
): Date[] {
  if (choice === 'none') return [];
  const birthday = nextBirthday(birthDate, now);
  const daysUntil = daysBetween(now, birthday);
  if (daysUntil < 0 || daysUntil > horizonDays) return [];
  const sameDay = atNine(birthday);
  const before = atNine(dayBefore(birthday));
  const candidates: Date[] = [];
  if (choice === 'day-before' || choice === 'both') candidates.push(before);
  if (choice === 'same-day' || choice === 'both') candidates.push(sameDay);
  return candidates.filter((date) => isFuture(date, now));
}

/**
 * Avisos de caducidad de un ítem de nevera. Mismo horario y mismos slots que
 * citas y cumpleaños: 09:00 local, día antes y mismo día.
 *
 * `expiryDate` es un día de calendario, no un instante. Se construye a medianoche
 * local para que `dayBefore`/`atNine` no desplacen el día en zonas al oeste de UTC.
 */
export function fridgeNotificationDates(
  expiryDate: Date,
  choice: ReminderChoice,
  now: Date,
): Date[] {
  if (choice === 'none') return [];
  const expiry = new Date(
    expiryDate.getFullYear(),
    expiryDate.getMonth(),
    expiryDate.getDate(),
  );
  const sameDay = atNine(expiry);
  const before = atNine(dayBefore(expiry));
  const candidates: Date[] = [];
  if (choice === 'day-before' || choice === 'both') candidates.push(before);
  if (choice === 'same-day' || choice === 'both') candidates.push(sameDay);
  return candidates.filter((date) => isFuture(date, now));
}

export function choiceFromReminderAt(
  reminderAt: string | null,
  startsAt: Date,
): ReminderChoice {
  if (!reminderAt) return 'none';
  const reminder = new Date(reminderAt);
  if (Number.isNaN(reminder.getTime()) || Number.isNaN(startsAt.getTime())) return 'none';
  const diffDays = (startsAt.getTime() - reminder.getTime()) / 86_400_000;
  return diffDays >= 1 ? 'both' : 'same-day';
}

export function slotForDate(trigger: Date, startsAt: string | Date): ReminderSlot {
  const start = new Date(startsAt);
  const triggerDay = new Date(trigger.getFullYear(), trigger.getMonth(), trigger.getDate()).getTime();
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  return triggerDay < startDay ? 'day-before' : 'same-day';
}

/**
 * Qué slot es un aviso de cumpleaños, según cuándo salta respecto al **próximo**
 * cumpleaños, no al año en que nació la persona.
 *
 * No es lo mismo que `slotForDate`, y por eso tiene su propia función. `slotForDate`
 * compara dos fechas que están en el mismo horizonte: la cita es de este mes o del
 * siguiente. Un cumpleaños se programa para dentro de un año, así que compararlo con
 * la fecha de nacimiento (típicamente décadas atrás) da siempre "más tarde que el
 * cumpleaños", o sea `same-day`, y el aviso del día anterior se etiquetaba como del
 * mismo día. Con `choice: "both"` los dos avisos caían en la misma clave del mapa y
 * el segundo pisaba al primero: el aviso del día antes se guardaba con el texto
 * "Cumpleaños hoy" y, además, su identificador se perdía, así que `cancelKeys` ya
 * no podía cancelar ese aviso y disparaba igual.
 *
 * El mismo fallo está en `slotForDate` para un cumpleaños, y no se arregla ahí porque
 * esa función se usa también para citas, donde sí es correcta.
 */
export function slotForBirthday(trigger: Date, birthDate: Date, now: Date): ReminderSlot {
  return slotForDate(trigger, nextBirthday(birthDate, now));
}

function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

export function appointmentFingerprint(
  appointment: Appointment,
  choice: ReminderChoice,
): string {
  return hashString(`${appointment.starts_at}|${choice}`);
}

export function birthdayFingerprint(contact: Contact, choice: ReminderChoice): string {
  return hashString(`${contact.birth_date}|${choice}`);
}

export function fridgeFingerprint(item: FridgeItem, choice: ReminderChoice): string {
  return hashString(`${item.name}|${item.expiry_date}|${item.quantity ?? ''}|${item.unit ?? ''}|${choice}`);
}

export function notificationKey(
  kind: 'appointment' | 'birthday' | 'fridge',
  id: string,
  slot: ReminderSlot,
): string {
  return `${kind}:${id}:${slot}`;
}

export function buildAppointmentContent(
  appointment: Appointment,
  slot: ReminderSlot,
): {
  title: string;
  body: string;
  data: { type: 'appointment'; id: string; slot: ReminderSlot };
} {
  const start = new Date(appointment.starts_at);
  const time = Number.isNaN(start.getTime())
    ? ''
    : new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(start);
  const dayLabel = slot === 'day-before' ? 'mañana' : 'hoy';
  return {
    title: `Cita ${dayLabel}: ${sanitizeNotificationText(appointment.title)}`,
    body: time
      ? `${sanitizeNotificationText(appointment.title)} a las ${time}.`
      : sanitizeNotificationText(appointment.title),
    data: { type: 'appointment', id: appointment.id, slot },
  };
}

export function buildBirthdayContent(
  contact: Contact,
  slot: ReminderSlot,
): {
  title: string;
  body: string;
  data: { type: 'birthday'; id: string; slot: ReminderSlot };
} {
  const dayLabel = slot === 'day-before' ? 'mañana' : 'hoy';
  return {
    title: `Cumpleaños ${dayLabel}: ${sanitizeNotificationText(contact.name)}`,
    body: `Es el cumpleaños de ${sanitizeNotificationText(contact.name)}.`,
    data: { type: 'birthday', id: contact.id, slot },
  };
}

export function buildFridgeContent(
  item: FridgeItem,
  slot: ReminderSlot,
): {
  title: string;
  body: string;
  data: { type: 'fridge'; id: string; slot: ReminderSlot };
} {
  const dayLabel = slot === 'day-before' ? 'mañana' : 'hoy';
  return {
    title: `Caduca ${dayLabel}: ${sanitizeNotificationText(item.name)}`,
    body: `El ${sanitizeNotificationText(item.name)} caduca ${dayLabel}.`,
    data: { type: 'fridge', id: item.id, slot },
  };
}