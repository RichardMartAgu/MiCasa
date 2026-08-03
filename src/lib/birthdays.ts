import type { Contact } from './types';
import { daysBetween, fromISODate, startOfDay } from './date';

export interface UpcomingBirthday {
  contact: Contact;
  date: Date;
  daysUntil: number;
  age: number;
}

export function ageOn(birthDate: Date, at: Date): number {
  let age = at.getFullYear() - birthDate.getFullYear();
  const monthDiff = at.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && at.getDate() < birthDate.getDate())) {
    age -= 1;
  }
  return age;
}

export function nextBirthday(birthDate: Date, from: Date): Date {
  let candidate = new Date(from.getFullYear(), birthDate.getMonth(), birthDate.getDate());
  if (candidate < startOfDay(from)) {
    candidate = new Date(from.getFullYear() + 1, birthDate.getMonth(), birthDate.getDate());
  }
  return candidate;
}

export function upcomingBirthdays(
  contacts: Contact[],
  from: Date,
  horizonDays = 30,
): UpcomingBirthday[] {
  const origin = startOfDay(from);
  const upcoming: UpcomingBirthday[] = [];

  for (const contact of contacts) {
    const birth = fromISODate(contact.birth_date);
    if (Number.isNaN(birth.getTime())) continue;
    const date = nextBirthday(birth, origin);
    const daysUntil = daysBetween(origin, date);
    if (daysUntil < 0 || daysUntil > horizonDays) continue;
    upcoming.push({
      contact,
      date,
      daysUntil,
      age: ageOn(birth, date),
    });
  }

  return upcoming.sort((a, b) => a.daysUntil - b.daysUntil);
}

export function birthdayLabel(daysUntil: number, locale = 'es-ES'): string {
  if (daysUntil === 0) return 'Hoy';
  if (daysUntil === 1) return 'Mañana';
  return new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(daysUntil, 'day');
}
