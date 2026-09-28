import { nextBirthday } from './birthdays';
import { daysBetween } from './date';
import type { Appointment, Contact } from './types';

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

function toISOLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

function atNine(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9, 0, 0, 0);
}

function dayBefore(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
}

function isFuture(date: Date, now: Date): boolean {
  return date.getTime() > now.getTime() + REMINDER_MARGIN_MS;
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
    reminderAtRaw: triggers.length > 0 ? toISOLocal(triggers[0]) : null,
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

export function notificationKey(
  kind: 'appointment' | 'birthday',
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
    title: `Cita ${dayLabel}: ${appointment.title}`,
    body: time ? `${appointment.title} a las ${time}.` : appointment.title,
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
    title: `Cumpleaños ${dayLabel}: ${contact.name}`,
    body: `Es el cumpleaños de ${contact.name}.`,
    data: { type: 'birthday', id: contact.id, slot },
  };
}