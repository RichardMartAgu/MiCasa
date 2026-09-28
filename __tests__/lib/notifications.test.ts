import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Alert, Linking, Platform } from 'react-native';

import {
  areNotificationsEnabled,
  askEnableNotifications,
  canRequestPermissionAgain,
  cancelEntityKey,
  ensureChannel,
  ensureNotificationsEnabled,
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

const REAL_TIMER_APIS = [
  'hrtime',
  'nextTick',
  'performance',
  'queueMicrotask',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
  'setImmediate',
  'clearImmediate',
  'setInterval',
  'clearInterval',
  'setTimeout',
  'clearTimeout',
] as const;

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
  jest.useFakeTimers({ doNotFake: [...REAL_TIMER_APIS] });
  jest.setSystemTime(NOW);
  jest.restoreAllMocks();
  jest.clearAllMocks();
  notifCounter = 0;
  mockSchedule.mockImplementation(() => Promise.resolve(`notif-id-${++notifCounter}`));
  mockStorage.clear();
  mockStorage.set('notifications_enabled', 'true');
});

afterEach(() => {
  jest.useRealTimers();
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
    mockStorage.delete('notifications_enabled');
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

  it('syncAll no agenda si desactivadas', async () => {
    mockStorage.delete('notifications_enabled');
    await syncAll([{ ...appointment, reminder_choice: 'both' }], [contact], 'both', NOW);
    expect(mockSchedule).not.toHaveBeenCalled();
  });
});

describe('gate cuando notificaciones desactivadas', () => {
  it('scheduleAppointment no agenda si desactivadas', async () => {
    mockStorage.delete('notifications_enabled');
    await scheduleAppointment(appointment, 'both');
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('scheduleBirthdays no agenda si desactivadas', async () => {
    mockStorage.delete('notifications_enabled');
    await scheduleBirthdays([contact], 'both');
    expect(mockSchedule).not.toHaveBeenCalled();
  });
});

describe('ensureNotificationsEnabled', () => {
  it('activa cuando desactivadas y permiso concedido', async () => {
    mockStorage.delete('notifications_enabled');
    mockGetPermissions.mockResolvedValue({ granted: false, canAskAgain: true });
    mockRequestPermissions.mockResolvedValue({ granted: true });
    const ok = await ensureNotificationsEnabled();
    expect(ok).toBe(true);
    expect(await areNotificationsEnabled()).toBe(true);
    expect(mockRequestPermissions).toHaveBeenCalled();
  });

  it('no activa si permiso denegado', async () => {
    mockStorage.delete('notifications_enabled');
    mockGetPermissions.mockResolvedValue({ granted: false, canAskAgain: true });
    mockRequestPermissions.mockResolvedValue({ granted: false });
    const ok = await ensureNotificationsEnabled();
    expect(ok).toBe(false);
    expect(await areNotificationsEnabled()).toBe(false);
  });

  it('ya activadas: no pide permiso', async () => {
    const ok = await ensureNotificationsEnabled();
    expect(ok).toBe(true);
    expect(mockRequestPermissions).not.toHaveBeenCalled();
  });
});

describe('canRequestPermissionAgain', () => {
  it('false si canAskAgain false', async () => {
    mockGetPermissions.mockResolvedValue({ granted: false, canAskAgain: false });
    expect(await canRequestPermissionAgain()).toBe(false);
  });

  it('true si canAskAgain true', async () => {
    mockGetPermissions.mockResolvedValue({ granted: false, canAskAgain: true });
    expect(await canRequestPermissionAgain()).toBe(true);
  });

  it('web: false', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    expect(await canRequestPermissionAgain()).toBe(false);
  });
});

describe('askEnableNotifications', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  function pressLastButton() {
    const calls = alertSpy.mock.calls;
    const buttons = calls[calls.length - 1][2] as unknown as {
      text: string;
      onPress?: () => void;
    }[];
    buttons[buttons.length - 1].onPress?.();
  }

  it('web: cancelled sin alert', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    expect(await askEnableNotifications('msg')).toBe('cancelled');
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('Ahora no: cancelled', async () => {
    const p = askEnableNotifications('msg');
    const calls = alertSpy.mock.calls;
    const buttons = calls[0][2] as unknown as {
      text: string;
      onPress?: () => void;
    }[];
    expect(buttons[0].text).toBe('Ahora no');
    buttons[0].onPress?.();
    expect(await p).toBe('cancelled');
  });

  it('Activar con permiso concedido: enabled y activadas', async () => {
    mockStorage.delete('notifications_enabled');
    mockGetPermissions.mockResolvedValue({ granted: false, canAskAgain: true });
    mockRequestPermissions.mockResolvedValue({ granted: true });
    const p = askEnableNotifications('msg');
    pressLastButton();
    expect(await p).toBe('enabled');
    expect(await areNotificationsEnabled()).toBe(true);
  });

  it('Activar con permiso denegado y canAskAgain false: ofrece abrir ajustes', async () => {
    mockStorage.delete('notifications_enabled');
    mockGetPermissions.mockResolvedValue({ granted: false, canAskAgain: false });
    mockRequestPermissions.mockResolvedValue({ granted: false });
    const p = askEnableNotifications('msg');
    pressLastButton();
    await new Promise((r) => setTimeout(r, 0));
    const calls = alertSpy.mock.calls;
    expect(calls).toHaveLength(2);
    const buttons = calls[1][2] as unknown as {
      text: string;
      onPress?: () => void;
    }[];
    expect(buttons.some((b) => b.text === 'Abrir ajustes')).toBe(true);
    buttons.find((b) => b.text === 'Cancelar')?.onPress?.();
    expect(await p).toBe('cancelled');
  });

  it('Activar con error de storage: cancelled sin colgar', async () => {
    const getItem = AsyncStorage.getItem as jest.Mock;
    getItem.mockRejectedValueOnce(new Error('storage boom'));
    const p = askEnableNotifications('msg');
    pressLastButton();
    expect(await p).toBe('cancelled');
  });

  it('Abrir ajustes: abre ajustes del sistema y resuelve cancelled', async () => {
    const openSettingsSpy = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    mockStorage.delete('notifications_enabled');
    mockGetPermissions.mockResolvedValue({ granted: false, canAskAgain: false });
    mockRequestPermissions.mockResolvedValue({ granted: false });
    const p = askEnableNotifications('msg');
    pressLastButton();
    await new Promise((r) => setTimeout(r, 0));
    const calls = alertSpy.mock.calls;
    const buttons = calls[1][2] as unknown as {
      text: string;
      onPress?: () => void;
    }[];
    buttons.find((b) => b.text === 'Abrir ajustes')?.onPress?.();
    expect(await p).toBe('cancelled');
    expect(openSettingsSpy).toHaveBeenCalled();
    openSettingsSpy.mockRestore();
  });

  it('Activar denegado y canAskAgain true: segundo alert solo con OK', async () => {
    mockStorage.delete('notifications_enabled');
    mockGetPermissions.mockResolvedValue({ granted: false, canAskAgain: true });
    mockRequestPermissions.mockResolvedValue({ granted: false });
    const p = askEnableNotifications('msg');
    pressLastButton();
    await new Promise((r) => setTimeout(r, 0));
    const calls = alertSpy.mock.calls;
    expect(calls).toHaveLength(2);
    const buttons = calls[1][2] as unknown as {
      text: string;
      onPress?: () => void;
    }[];
    expect(buttons.some((b) => b.text === 'Abrir ajustes')).toBe(false);
    expect(buttons.some((b) => b.text === 'OK')).toBe(true);
    buttons.find((b) => b.text === 'OK')?.onPress?.();
    expect(await p).toBe('cancelled');
  });

  it('descartar el diálogo con onDismiss resuelve cancelled sin colgarse', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const p = askEnableNotifications('msg');
    const options = alertSpy.mock.calls[0][3] as unknown as {
      cancelable?: boolean;
      onDismiss?: () => void;
    } | undefined;
    expect(options?.cancelable).toBe(true);
    options?.onDismiss?.();
    expect(await p).toBe('cancelled');
  });

  it('descartar el segundo diálogo (permiso denegado) también resuelve', async () => {
    mockStorage.delete('notifications_enabled');
    mockGetPermissions.mockResolvedValue({ granted: false, canAskAgain: false });
    mockRequestPermissions.mockResolvedValue({ granted: false });
    const p = askEnableNotifications('msg');
    pressLastButton();
    await new Promise((r) => setTimeout(r, 0));
    const options = alertSpy.mock.calls[1][3] as unknown as {
      cancelable?: boolean;
      onDismiss?: () => void;
    } | undefined;
    expect(options?.cancelable).toBe(true);
    options?.onDismiss?.();
    expect(await p).toBe('cancelled');
  });
});

describe('cola: recuperación ante tarea colgada', () => {
  it('una operación colgada no bloquea las siguientes', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    mockStorage.set('notifications_enabled', 'true');

    // Primera operación se cuelga para siempre (expo-notifications no responde).
    mockSchedule.mockImplementationOnce(() => new Promise<string>(() => undefined));
    const hung = scheduleAppointment({ ...appointment, reminder_choice: 'both' }, 'both');
    const hungSettled = jest.fn();
    void hung.then(hungSettled, hungSettled);

    // La segunda debe ejecutarse igual gracias al corte por tiempo de la cola.
    mockSchedule.mockImplementation(() => Promise.resolve('notif-luego'));
    await expect(scheduleAppointment({ ...appointment, id: 'a2' }, 'both')).resolves.toBeUndefined();
    expect(mockSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({ data: expect.objectContaining({ id: 'a2' }) }),
      }),
    );
    expect(hungSettled).toHaveBeenCalled();
  });
});