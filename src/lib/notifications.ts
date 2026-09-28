import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Alert, Linking, Platform } from 'react-native';

import { safeDate } from './date';
import {
  appointmentFingerprint,
  appointmentReminderDates,
  birthdayFingerprint,
  birthdayNotificationDates,
  buildAppointmentContent,
  buildBirthdayContent,
  choiceFromReminderAt,
  notificationKey,
  reminderChoices,
  slotForDate,
  type ReminderChoice,
} from './notification-schedule';
import type { Appointment, Contact } from './types';

const CHANNEL_ID = 'recordatorios';
const ENABLED_KEY = 'notifications_enabled';
const BIRTHDAY_CHOICE_KEY = 'birthday_choice';
const MAP_KEY = 'notification_map_v1';

type NotificationMap = Record<string, { identifiers: string[]; fingerprint: string }>;

// Cola módulo-level: serializa operaciones que leen/escriben el mapa AsyncStorage
// y programan notificaciones. Evita races entre syncAll (realtime) y el resto.
let queue: Promise<void> = Promise.resolve();

// Una tarea colgada (expo-notifications sin resolver) envenenaría la cola para
// siempre: cada enqueue() posterior quedaría esperando. El corte por tiempo
// libera la cola y degrada solo esa operación.
const QUEUE_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Notificación: la operación tardó demasiado.')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(
    () => withTimeout(Promise.resolve().then(fn), QUEUE_TIMEOUT_MS),
    () => withTimeout(Promise.resolve().then(fn), QUEUE_TIMEOUT_MS),
  );
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readMap(): Promise<NotificationMap> {
  const raw = await AsyncStorage.getItem(MAP_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as NotificationMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeMap(map: NotificationMap): Promise<void> {
  await AsyncStorage.setItem(MAP_KEY, JSON.stringify(map));
}

export function setupNotificationHandler(): void {
  if (Platform.OS === 'web') return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Recordatorios',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#3B82F6',
  });
}

export async function requestPermissions(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  await ensureChannel();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

export async function canRequestPermissionAgain(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const current = await Notifications.getPermissionsAsync();
  return current.canAskAgain !== false;
}

export async function ensureNotificationsEnabled(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if (await areNotificationsEnabled()) return true;
  const granted = await requestPermissions();
  if (!granted) return false;
  await setNotificationsEnabled(true);
  return true;
}

export function askEnableNotifications(message: string): Promise<'enabled' | 'cancelled'> {
  if (Platform.OS === 'web') return Promise.resolve('cancelled');
  return new Promise((resolve) => {
    // Android permite descartar el diálogo con el botón atrás o tocando fuera.
    // Sin onDismiss el Promise quedaba colgado y bloqueaba el flujo que lo espera.
    let settled = false;
    const settle = (value: 'enabled' | 'cancelled') => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    Alert.alert(
      'Notificaciones desactivadas',
      message,
      [
        { text: 'Ahora no', style: 'cancel', onPress: () => settle('cancelled') },
        {
          text: 'Activar',
          onPress: () => {
            void (async () => {
              try {
                const ok = await ensureNotificationsEnabled();
                if (ok) {
                  settle('enabled');
                  return;
                }
              } catch {
                settle('cancelled');
                return;
              }
              try {
                const canAsk = await canRequestPermissionAgain();
                Alert.alert(
                  'Permiso denegado',
                  'Activa las notificaciones desde los ajustes del sistema para recibir avisos.',
                  canAsk
                    ? [{ text: 'OK', onPress: () => settle('cancelled') }]
                    : [
                        { text: 'Cancelar', style: 'cancel', onPress: () => settle('cancelled') },
                        {
                          text: 'Abrir ajustes',
                          onPress: () => {
                            void Linking.openSettings().catch(() => undefined);
                            settle('cancelled');
                          },
                        },
                      ],
                  { cancelable: true, onDismiss: () => settle('cancelled') },
                );
              } catch {
                settle('cancelled');
              }
            })();
          },
        },
      ],
      { cancelable: true, onDismiss: () => settle('cancelled') },
    );
  });
}

export async function areNotificationsEnabled(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const value = await AsyncStorage.getItem(ENABLED_KEY);
  return value === 'true';
}

export async function setNotificationsEnabled(enabled: boolean): Promise<void> {
  if (Platform.OS === 'web') return;
  await AsyncStorage.setItem(ENABLED_KEY, String(enabled));
  if (!enabled) {
    await enqueue(async () => {
      await Notifications.cancelAllScheduledNotificationsAsync();
      await AsyncStorage.removeItem(MAP_KEY);
    });
  }
}

export async function getBirthdayChoice(): Promise<ReminderChoice> {
  if (Platform.OS === 'web') return 'none';
  const value = await AsyncStorage.getItem(BIRTHDAY_CHOICE_KEY);
  return reminderChoices.includes(value as ReminderChoice) ? (value as ReminderChoice) : 'none';
}

export async function setBirthdayChoice(choice: ReminderChoice): Promise<void> {
  if (Platform.OS === 'web') return;
  await AsyncStorage.setItem(BIRTHDAY_CHOICE_KEY, choice);
}

async function cancelKeys(map: NotificationMap, keys: string[]): Promise<string[]> {
  const identifiers: string[] = [];
  for (const key of keys) {
    const entry = map[key];
    if (entry) {
      identifiers.push(...entry.identifiers);
      delete map[key];
    }
  }
  return identifiers;
}

async function cancelIdentifiers(identifiers: string[]): Promise<void> {
  for (const identifier of identifiers) {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  }
}

export async function scheduleAppointment(
  appointment: Appointment,
  choice: ReminderChoice,
): Promise<void> {
  if (Platform.OS === 'web') return;
  if (!(await areNotificationsEnabled())) return;
  await enqueue(async () => {
    const map = await readMap();
    const keys = [
      notificationKey('appointment', appointment.id, 'day-before'),
      notificationKey('appointment', appointment.id, 'same-day'),
    ];
    await cancelIdentifiers(await cancelKeys(map, keys));
    const { triggers } = appointmentReminderDates(new Date(appointment.starts_at), choice);
    const fingerprint = appointmentFingerprint(appointment, choice);
    for (const trigger of triggers) {
      const slot = slotForDate(trigger, appointment.starts_at);
      const identifier = await Notifications.scheduleNotificationAsync({
        content: buildAppointmentContent(appointment, slot),
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: trigger,
          channelId: CHANNEL_ID,
        },
      });
      map[notificationKey('appointment', appointment.id, slot)] = {
        identifiers: [identifier],
        fingerprint,
      };
    }
    await writeMap(map);
  });
}

export async function scheduleBirthdays(
  contacts: Contact[],
  choice: ReminderChoice,
): Promise<void> {
  if (Platform.OS === 'web') return;
  if (!(await areNotificationsEnabled())) return;
  await enqueue(async () => {
    const map = await readMap();
    const birthdayKeys = Object.keys(map).filter((key) => key.startsWith('birthday:'));
    await cancelIdentifiers(await cancelKeys(map, birthdayKeys));
    const now = new Date();
    for (const contact of contacts) {
      const birth = safeDate(contact.birth_date);
      if (birth === null) continue;
      const dates = birthdayNotificationDates(birth, choice, now);
      const fingerprint = birthdayFingerprint(contact, choice);
      for (const trigger of dates) {
        const slot = slotForDate(trigger, birth);
        const identifier = await Notifications.scheduleNotificationAsync({
          content: buildBirthdayContent(contact, slot),
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: trigger,
            channelId: CHANNEL_ID,
          },
        });
        map[notificationKey('birthday', contact.id, slot)] = {
          identifiers: [identifier],
          fingerprint,
        };
      }
    }
    await writeMap(map);
  });
}

export async function cancelEntityKey(
  kind: 'appointment' | 'birthday',
  id: string,
): Promise<void> {
  if (Platform.OS === 'web') return;
  await enqueue(async () => {
    const map = await readMap();
    const keys = [notificationKey(kind, id, 'day-before'), notificationKey(kind, id, 'same-day')];
    await cancelIdentifiers(await cancelKeys(map, keys));
    await writeMap(map);
  });
}

export async function syncAll(
  appointments: Appointment[],
  contacts: Contact[],
  birthdayChoice: ReminderChoice,
  now = new Date(),
): Promise<void> {
  if (Platform.OS === 'web') return;
  if (!(await areNotificationsEnabled())) return;
  await enqueue(async () => {
    const map = await readMap();
    const seenKeys = new Set<string>();
    const toCancel: string[] = [];

    for (const appointment of appointments) {
      const choice = reminderChoices.includes(appointment.reminder_choice as ReminderChoice)
        ? (appointment.reminder_choice as ReminderChoice)
        : choiceFromReminderAt(appointment.reminder_at, new Date(appointment.starts_at));
      if (choice === 'none') continue;
      const { triggers } = appointmentReminderDates(
        new Date(appointment.starts_at),
        choice,
        now,
      );
      const keys = [
        notificationKey('appointment', appointment.id, 'day-before'),
        notificationKey('appointment', appointment.id, 'same-day'),
      ];
      if (triggers.length === 0) {
        await cancelIdentifiers(await cancelKeys(map, keys));
        continue;
      }
      const fingerprint = appointmentFingerprint(appointment, choice);
      let matched = false;
      for (const key of keys) {
        const entry = map[key];
        if (!entry) continue;
        seenKeys.add(key);
        if (entry.fingerprint === fingerprint) {
          matched = true;
        } else {
          toCancel.push(...entry.identifiers);
          delete map[key];
        }
      }
      if (matched) continue;
      for (const trigger of triggers) {
        const slot = slotForDate(trigger, appointment.starts_at);
        const identifier = await Notifications.scheduleNotificationAsync({
          content: buildAppointmentContent(appointment, slot),
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: trigger,
            channelId: CHANNEL_ID,
          },
        });
        map[notificationKey('appointment', appointment.id, slot)] = {
          identifiers: [identifier],
          fingerprint,
        };
        seenKeys.add(notificationKey('appointment', appointment.id, slot));
      }
    }

    for (const contact of contacts) {
      const birth = safeDate(contact.birth_date);
      if (birth === null) continue;
      const dates = birthdayNotificationDates(birth, birthdayChoice, now);
      const fingerprint = birthdayFingerprint(contact, birthdayChoice);
      const keys = [
        notificationKey('birthday', contact.id, 'day-before'),
        notificationKey('birthday', contact.id, 'same-day'),
      ];
      let matched = false;
      for (const key of keys) {
        const entry = map[key];
        if (!entry) continue;
        seenKeys.add(key);
        if (entry.fingerprint === fingerprint) {
          matched = true;
        } else {
          toCancel.push(...entry.identifiers);
          delete map[key];
        }
      }
      if (matched) continue;
      for (const trigger of dates) {
        const slot = slotForDate(trigger, birth);
        const identifier = await Notifications.scheduleNotificationAsync({
          content: buildBirthdayContent(contact, slot),
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: trigger,
            channelId: CHANNEL_ID,
          },
        });
        map[notificationKey('birthday', contact.id, slot)] = {
          identifiers: [identifier],
          fingerprint,
        };
        seenKeys.add(notificationKey('birthday', contact.id, slot));
      }
    }

    for (const key of Object.keys(map)) {
      if (!seenKeys.has(key)) {
        const entry = map[key];
        if (entry) toCancel.push(...entry.identifiers);
        delete map[key];
      }
    }
    await cancelIdentifiers(toCancel);
    await writeMap(map);
  });
}