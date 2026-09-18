import * as Calendar from 'expo-calendar';

import type { Contact } from './types';
import { safeDate } from './date';

const CALENDAR_NAME = 'MiCasa Cumpleaños';

export interface SyncResult {
  synced: number;
  errors: number;
}

export async function requestCalendarPermissions(): Promise<boolean> {
  const { status } = await Calendar.requestCalendarPermissions();
  return status === 'granted';
}

export async function getOrCreateBirthdayCalendar(): Promise<Calendar.ExpoCalendar | null> {
  const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);

  const existing = calendars.find(
    (c) => c.title === CALENDAR_NAME && c.allowsModifications,
  );
  if (existing) return existing;

  const sources = Calendar.getSourcesSync();
  const source =
    sources.find((s) => s.type === Calendar.SourceType.CALDAV) ??
    sources.find((s) => s.type === Calendar.SourceType.LOCAL) ??
    sources[0];
  if (!source) return null;

  return Calendar.createCalendar({
    title: CALENDAR_NAME,
    color: '#208AEF',
    entityType: Calendar.EntityTypes.EVENT,
    sourceId: source.id,
    source,
    name: CALENDAR_NAME,
    ownerAccount: 'personal',
    accessLevel: Calendar.CalendarAccessLevel.OWNER,
  });
}

export async function syncBirthdays(contacts: Contact[]): Promise<SyncResult> {
  try {
    const granted = await requestCalendarPermissions();
    if (!granted) return { synced: 0, errors: 0 };

    const calendar = await getOrCreateBirthdayCalendar();
    if (!calendar) return { synced: 0, errors: 0 };

    let synced = 0;
    let errors = 0;

    for (const contact of contacts) {
      const birthDate = safeDate(contact.birth_date);
      if (birthDate === null) continue;

      try {
        const title = `🎂 ${contact.name}`;
        const startDate = new Date(birthDate.getFullYear(), birthDate.getMonth(), birthDate.getDate(), 9, 0);
        const endDate = new Date(birthDate.getFullYear(), birthDate.getMonth(), birthDate.getDate(), 10, 0);
        const notes = contact.relationship ? `Parentesco: ${contact.relationship}` : '';

        const existing = await findBirthdayEvent(title, calendar.id);
        if (existing) {
          await existing.update({
            title,
            startDate,
            endDate,
            allDay: true,
            notes,
            alarms: [{ relativeOffset: 0 }],
            recurrenceRule: yearlyRule(),
          });
        } else {
          await calendar.createEvent({
            title,
            startDate,
            endDate,
            allDay: true,
            notes,
            alarms: [{ relativeOffset: 0 }],
            recurrenceRule: yearlyRule(),
          });
        }
        synced++;
      } catch (e) {
        console.warn('syncBirthdays: fallo al crear evento de cumpleaños', e);
        errors++;
      }
    }

    return { synced, errors };
  } catch (e) {
    console.warn('syncBirthdays: fallo al acceder al calendario', e);
    return { synced: 0, errors: 0 };
  }
}

async function findBirthdayEvent(
  title: string,
  calendarId: string,
): Promise<Calendar.ExpoCalendarEvent | null> {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const endOfYear = new Date(now.getFullYear(), 11, 31, 23, 59, 59);

  const events = await Calendar.listEvents([calendarId], startOfYear, endOfYear);
  return events.find((e) => e.title === title) ?? null;
}

function yearlyRule(): Calendar.RecurrenceRule {
  return {
    frequency: Calendar.Frequency.YEARLY,
    interval: 1,
  };
}