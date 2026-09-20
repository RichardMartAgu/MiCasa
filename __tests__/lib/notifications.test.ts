import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  areNotificationsEnabled,
  cancelEntityKey,
  ensureChannel,
  getBirthdayChoice,
  requestPermissions,
  scheduleAppointment,
  scheduleBirthdays,
  setBirthdayChoice,
  setNotificationsEnabled,
  setupNotificationHandler,
  syncAll,
} from '@/lib/notifications';
import type { Appointment, Contact } from '@/lib/types';

const mockSetNotificationHandler = jest.fn();
const mockSetChannel = jest.fn();
const mockGetPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
const mockSchedule = jest.fn();
const mockCancel = jest.fn();
const mockCancelAll = jest.fn();
const mockGetAll = jest.fn();

jest.mock('expo-notifications', () => ({
  setNotificationHandler: (...args: unknown[]) => mockSetNotificationHandler(...args),
  setNotificationChannelAsync: (...args: unknown[]) => mockSetChannel(...args),
  getPermissionsAsync: (...args: unknown[]) => mockGetPermissions(...args),
  requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissions(...args),
  scheduleNotificationAsync: (...args: unknown[]) => mockSchedule(...args),
  cancelScheduledNotificationAsync: (...args: unknown[]) => mockCancel(...args),
  cancelAllScheduledNotificationsAsync: (...args: unknown[]) => mockCancelAll(...args),
  getAllScheduledNotificationsAsync: (...args: unknown[]) => mockGetAll(...args),
  AndroidImportance: { MAX: 4 },
  SchedulableTriggerInputTypes: { DATE: 1 },
}));

const mockStorage = new Map<string, string>();
let notifCounter = 0;

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((key: string) => Promise.resolve(mockStorage.get(key) ?? null)),
    setItem: jest.fn((key: string, value: string) => {
      mockStorage.set(key, value);
      return Promise.resolve();
    }),
    removeItem: jest.fn((key: string) => {
      mockStorage.delete(key);
      return Promise.resolve();
    }),
    clear: jest.fn(() => {
      mockStorage.clear();
      return Promise.resolve();
    }),
  },
}));

function toISOLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:00`;
}

const NOW = new Date(2026, 8, 20, 8, 0);
const START = new Date(2026, 8, 25, 10, 0);

const appointment: Appointment = {
  id: 'a1',
  casa_id: 'c1',
  user_id: 'u1',
  title: 'Dentista',
  description: null,
  person: null,
  location: null,
  kind: 'medico',
  starts_at: toISOLocal(START),
  reminder_at: null,
  reminder_choice: 'none',
  created_at: '2026-09-01',
};

const contact: Contact = {
  id: 'c1',
  casa_id: 'c1',
  user_id: 'u1',
  name: 'Ana',
  birth_date: toISOLocal(new Date(2026, 11, 15)).slice(0, 10),
  relationship: 'Hija',
  phone: null,
  created_at: '2026-01-01',
};

beforeEach(async () => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  notifCounter = 0;
  mockSchedule.mockImplementation(() => Promise.resolve(`notif-id-${++notifCounter}`));
  mockStorage.clear();
});

describe('setupNotificationHandler', () => {
  it('registra el handler una vez', () => {
    setupNotificationHandler();
    expect(mockSetNotificationHandler).toHaveBeenCalledTimes(1);
  });

  it('web: no registra handler', () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    setupNotificationHandler();
    expect(mockSetNotificationHandler).not.toHaveBeenCalled();
  });
});

describe('ensureChannel', () => {
  it('no-op en iOS', async () => {
    await ensureChannel();
    expect(mockSetChannel).not.toHaveBeenCalled();
  });

  it('crea canal en Android', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await ensureChannel();
    expect(mockSetChannel).toHaveBeenCalledWith(
      'recordatorios',
      expect.objectContaining({ importance: 4 }),
    );
  });
});

describe('requestPermissions', () => {
  it('Android: crea canal antes de pedir permiso', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    mockGetPermissions.mockResolvedValue({ granted: true });
    await requestPermissions();
    expect(mockSetChannel).toHaveBeenCalled();
    expect(mockGetPermissions).toHaveBeenCalled();
    expect(mockRequestPermissions).not.toHaveBeenCalled();
  });

  it('pide permiso si no concedido', async () => {
    mockGetPermissions.mockResolvedValue({ granted: false });
    mockRequestPermissions.mockResolvedValue({ granted: true });
    const granted = await requestPermissions();
    expect(mockRequestPermissions).toHaveBeenCalled();
    expect(granted).toBe(true);
  });

  it('web: no-op y false', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const granted = await requestPermissions();
    expect(granted).toBe(false);
    expect(mockGetPermissions).not.toHaveBeenCalled();
    expect(mockRequestPermissions).not.toHaveBeenCalled();
  });
});

describe('preferencias', () => {
  it('notificaciones deshabilitadas por defecto', async () => {
    expect(await areNotificationsEnabled()).toBe(false);
  });

  it('setNotificationsEnabled(false) cancela todo y limpia mapa', async () => {
    await scheduleAppointment(appointment, 'both');
    await setNotificationsEnabled(false);
    expect(mockCancelAll).toHaveBeenCalled();
    expect(await areNotificationsEnabled()).toBe(false);
    const map = JSON.parse((await AsyncStorage.getItem('notification_map_v1')) ?? '{}');
    expect(Object.keys(map)).toHaveLength(0);
  });

  it('cumpleaños por defecto none y persiste elección', async () => {
    expect(await getBirthdayChoice()).toBe('none');
    await setBirthdayChoice('both');
    expect(await getBirthdayChoice()).toBe('both');
  });
});

describe('scheduleAppointment', () => {
  it('agenda avisos y guarda mapa con fingerprint', async () => {
    await scheduleAppointment(appointment, 'both');
    expect(mockSchedule).toHaveBeenCalledTimes(2);
    const map = JSON.parse((await AsyncStorage.getItem('notification_map_v1')) ?? '{}');
    expect(map['appointment:a1:day-before'].identifiers).toEqual(['notif-id-1']);
    expect(map['appointment:a1:same-day'].identifiers).toEqual(['notif-id-2']);
    expect(map['appointment:a1:day-before'].fingerprint).toBeTruthy();
  });

  it('cancela avisos previos al reprogramar', async () => {
    await scheduleAppointment(appointment, 'day-before');
    expect(mockCancel).not.toHaveBeenCalled();
    await scheduleAppointment(appointment, 'both');
    expect(mockCancel).toHaveBeenCalledWith('notif-id-1');
  });

  it('cancela previos y no agenda nada si todos los triggers pasados', async () => {
    await scheduleAppointment(appointment, 'both');
    mockCancel.mockClear();
    mockSchedule.mockClear();
    const past = { ...appointment, starts_at: '2020-01-01T10:00:00' };
    await scheduleAppointment(past, 'both');
    expect(mockCancel).toHaveBeenCalledTimes(2);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('web: no-op', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    await scheduleAppointment(appointment, 'both');
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('serializa: dos scheduleAppointment consecutivos conservan ambas entradas', async () => {
    const second = { ...appointment, id: 'a2' };
    await Promise.all([scheduleAppointment(appointment, 'both'), scheduleAppointment(second, 'both')]);
    const map = JSON.parse((await AsyncStorage.getItem('notification_map_v1')) ?? '{}');
    expect(map['appointment:a1:day-before']).toBeDefined();
    expect(map['appointment:a1:same-day']).toBeDefined();
    expect(map['appointment:a2:day-before']).toBeDefined();
    expect(map['appointment:a2:same-day']).toBeDefined();
  });
});

describe('scheduleBirthdays', () => {
  it('agenda por contacto con fingerprint propio', async () => {
    await scheduleBirthdays([contact], 'both');
    expect(mockSchedule).toHaveBeenCalledTimes(2);
    const map = JSON.parse((await AsyncStorage.getItem('notification_map_v1')) ?? '{}');
    expect(map['birthday:c1:day-before'].identifiers).toEqual(['notif-id-1']);
    expect(map['birthday:c1:same-day'].identifiers).toEqual(['notif-id-2']);
  });

  it('cancela previos y no agenda nada si no hay fechas', async () => {
    await scheduleBirthdays([contact], 'both');
    mockCancel.mockClear();
    mockSchedule.mockClear();
    await scheduleBirthdays([contact], 'none');
    expect(mockCancel).toHaveBeenCalledTimes(2);
    expect(mockSchedule).not.toHaveBeenCalled();
  });
});

describe('cancelEntityKey', () => {
  it('cancela identificadores y limpia mapa', async () => {
    await scheduleAppointment(appointment, 'both');
    await cancelEntityKey('appointment', 'a1');
    expect(mockCancel).toHaveBeenCalledWith('notif-id-1');
    expect(mockCancel).toHaveBeenCalledWith('notif-id-2');
    const map = JSON.parse((await AsyncStorage.getItem('notification_map_v1')) ?? '{}');
    expect(map['appointment:a1:day-before']).toBeUndefined();
    expect(map['appointment:a1:same-day']).toBeUndefined();
  });
});

describe('syncAll', () => {
  it('skip si fingerprint coincide', async () => {
    await scheduleAppointment(appointment, 'both');
    mockSchedule.mockClear();
    mockCancel.mockClear();
    await syncAll([{ ...appointment, reminder_choice: 'both' }], [], 'none', NOW);
    expect(mockSchedule).not.toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('reprograma si cambia el aviso', async () => {
    await scheduleAppointment(appointment, 'both');
    mockSchedule.mockClear();
    mockCancel.mockClear();
    await syncAll([{ ...appointment, reminder_choice: 'same-day' }], [], 'none', NOW);
    expect(mockCancel).toHaveBeenCalledWith('notif-id-1');
    expect(mockCancel).toHaveBeenCalledWith('notif-id-2');
    expect(mockSchedule).toHaveBeenCalledTimes(1);
  });

  it('usa fallback legacy si reminder_choice vacío', async () => {
    await scheduleAppointment(appointment, 'both');
    mockSchedule.mockClear();
    mockCancel.mockClear();
    const dayBefore = toISOLocal(new Date(2026, 8, 24, 9, 0));
    await syncAll(
      [{ ...appointment, reminder_choice: '', reminder_at: dayBefore }],
      [],
      'none',
      NOW,
    );
    expect(mockSchedule).not.toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('toleran JSON corrupto en el mapa', async () => {
    await AsyncStorage.setItem('notification_map_v1', '{not-json');
    mockSchedule.mockClear();
    await syncAll([{ ...appointment, reminder_choice: 'both' }], [], 'none', NOW);
    expect(mockSchedule).toHaveBeenCalledTimes(2);
  });

  it('birthdays: skip si fingerprint coincide', async () => {
    await scheduleBirthdays([contact], 'both');
    mockSchedule.mockClear();
    mockCancel.mockClear();
    await syncAll([], [contact], 'both', NOW);
    expect(mockSchedule).not.toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('birthdays: reprograma si cambia el aviso', async () => {
    await scheduleBirthdays([contact], 'both');
    mockSchedule.mockClear();
    mockCancel.mockClear();
    await syncAll([], [contact], 'same-day', NOW);
    expect(mockCancel).toHaveBeenCalledTimes(2);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
  });

  it('cancela entidades borradas', async () => {
    await scheduleAppointment(appointment, 'both');
    await scheduleBirthdays([contact], 'both');
    mockCancel.mockClear();
    await syncAll([], [], 'none', NOW);
    expect(mockCancel).toHaveBeenCalledTimes(4);
    const map = JSON.parse((await AsyncStorage.getItem('notification_map_v1')) ?? '{}');
    expect(Object.keys(map)).toHaveLength(0);
  });

  it('no deja entradas stale para cita pasada (mapa limpio)', async () => {
    await scheduleAppointment(appointment, 'both');
    mockCancel.mockClear();
    const past = { ...appointment, starts_at: '2020-01-01T10:00:00', reminder_choice: 'both' };
    await syncAll([past], [], 'none', NOW);
    expect(mockCancel).toHaveBeenCalledTimes(2);
    const map = JSON.parse((await AsyncStorage.getItem('notification_map_v1')) ?? '{}');
    expect(Object.keys(map)).toHaveLength(0);
  });
});