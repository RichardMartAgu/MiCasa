import * as Calendar from 'expo-calendar';

import {
  getOrCreateBirthdayCalendar,
  requestCalendarPermissions,
  syncBirthdays,
} from '@/lib/calendar-sync';
import type { Contact } from '@/lib/types';

jest.mock('expo-calendar', () => {
  const createEventMock = jest.fn();
  const updateMock = jest.fn();
  return {
    requestCalendarPermissions: jest.fn(),
    getCalendars: jest.fn(),
    getSourcesSync: jest.fn(),
    createCalendar: jest.fn(),
    listEvents: jest.fn(),
    EntityTypes: { EVENT: 0 },
    SourceType: { LOCAL: 'local', CALDAV: 'caldav' },
    CalendarAccessLevel: { OWNER: 400 },
    Frequency: { YEARLY: 3 },
    createEventMock,
    updateMock,
  };
});

const mockRequestPermissions = Calendar.requestCalendarPermissions as jest.Mock;
const mockGetCalendars = Calendar.getCalendars as jest.Mock;
const mockGetSourcesSync = Calendar.getSourcesSync as jest.Mock;
const mockCreateCalendar = Calendar.createCalendar as jest.Mock;
const mockListEvents = Calendar.listEvents as jest.Mock;
const createEventMock = (Calendar as unknown as { createEventMock: jest.Mock }).createEventMock;
const updateMock = (Calendar as unknown as { updateMock: jest.Mock }).updateMock;

const contact: Contact = {
  id: 'c1',
  casa_id: 'casa1',
  user_id: 'u1',
  name: 'Ana',
  birth_date: '1990-05-12',
  relationship: 'Hija',
  phone: null,
  created_at: '2026-01-01',
};

const existingCalendar = {
  id: 'cal-1',
  title: 'MiCasa Cumpleaños',
  allowsModifications: true,
  createEvent: createEventMock,
};

const existingEvent = {
  id: 'evt-1',
  title: '🎂 Ana',
  update: updateMock,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRequestPermissions.mockResolvedValue({ status: 'granted' });
  mockGetCalendars.mockResolvedValue([existingCalendar]);
  mockCreateCalendar.mockResolvedValue(existingCalendar);
  mockListEvents.mockResolvedValue([]);
});

describe('requestCalendarPermissions', () => {
  it('devuelve true si concedido', async () => {
    await expect(requestCalendarPermissions()).resolves.toBe(true);
  });

  it('devuelve false si denegado', async () => {
    mockRequestPermissions.mockResolvedValue({ status: 'denied' });
    await expect(requestCalendarPermissions()).resolves.toBe(false);
  });
});

describe('getOrCreateBirthdayCalendar', () => {
  it('reutiliza el calendario MiCasa existente', async () => {
    await expect(getOrCreateBirthdayCalendar()).resolves.toBe(existingCalendar);
    expect(mockGetCalendars).toHaveBeenCalledWith(0);
    expect(mockCreateCalendar).not.toHaveBeenCalled();
  });

  it('crea calendario si no existe', async () => {
    mockGetCalendars.mockResolvedValue([]);
    mockGetSourcesSync.mockReturnValue([{ id: 'src-1', type: 'caldav', name: 'Google' }]);

    const result = await getOrCreateBirthdayCalendar();

    expect(result).toBe(existingCalendar);
    expect(mockCreateCalendar).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'MiCasa Cumpleaños' }),
    );
  });

  it('devuelve null sin fuentes disponibles', async () => {
    mockGetCalendars.mockResolvedValue([]);
    mockGetSourcesSync.mockReturnValue([]);

    await expect(getOrCreateBirthdayCalendar()).resolves.toBeNull();
  });
});

describe('syncBirthdays', () => {
  it('crea evento recurrente anual por contacto', async () => {
    const result = await syncBirthdays([contact]);

    expect(result).toEqual({ synced: 1, errors: 0 });
    expect(createEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '🎂 Ana',
        allDay: true,
        notes: 'Parentesco: Hija',
        recurrenceRule: { frequency: 3, interval: 1 },
        alarms: [{ relativeOffset: 0 }],
      }),
    );
  });

  it('salta contactos sin fecha válida', async () => {
    const invalid: Contact = { ...contact, id: 'c2', birth_date: 'not-a-date' };

    const result = await syncBirthdays([contact, invalid]);

    expect(result).toEqual({ synced: 1, errors: 0 });
    expect(createEventMock).toHaveBeenCalledTimes(1);
  });

  it('actualiza evento existente en vez de duplicar', async () => {
    mockListEvents.mockResolvedValue([existingEvent]);

    const result = await syncBirthdays([contact]);

    expect(result).toEqual({ synced: 1, errors: 0 });
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: '🎂 Ana', allDay: true }),
    );
    expect(createEventMock).not.toHaveBeenCalled();
  });

  it('devuelve {0,0} si permisos denegados', async () => {
    mockRequestPermissions.mockResolvedValue({ status: 'denied' });

    const result = await syncBirthdays([contact]);

    expect(result).toEqual({ synced: 0, errors: 0 });
    expect(mockGetCalendars).not.toHaveBeenCalled();
  });

  it('cuenta errores por fallo individual', async () => {
    createEventMock.mockRejectedValueOnce(new Error('boom'));

    const result = await syncBirthdays([contact]);

    expect(result).toEqual({ synced: 0, errors: 1 });
  });
});