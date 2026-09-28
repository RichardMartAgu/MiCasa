import {
  appointmentFingerprint,
  appointmentReminderDates,
  birthdayFingerprint,
  birthdayNotificationDates,
  buildAppointmentContent,
  buildBirthdayContent,
  choiceFromReminderAt,
  notificationKey,
  reminderChoiceLabels,
  reminderChoices,
  slotForDate,
} from '@/lib/notification-schedule';
import type { Appointment, Contact } from '@/lib/types';

const appointment: Appointment = {
  id: 'a1',
  casa_id: 'c1',
  user_id: 'u1',
  title: 'Dentista',
  description: null,
  person: 'Leo',
  location: 'Clínica',
  kind: 'medico',
  starts_at: '2026-09-25T10:00:00',
  reminder_at: null,
  reminder_choice: 'none',
  created_at: '2026-09-01',
};

const contact: Contact = {
  id: 'c1',
  casa_id: 'c1',
  user_id: 'u1',
  name: 'Ana',
  birth_date: '1990-05-12',
  relationship: 'Hija',
  phone: null,
  created_at: '2026-01-01',
};

describe('reminderChoices', () => {
  it('expone las 4 opciones con etiquetas', () => {
    expect(reminderChoices).toEqual(['none', 'day-before', 'same-day', 'both']);
    for (const choice of reminderChoices) {
      expect(reminderChoiceLabels[choice].length).toBeGreaterThan(0);
    }
  });
});

describe('appointmentReminderDates', () => {
  const startsAt = new Date(2026, 8, 25, 10, 0);
  const now = new Date(2026, 8, 20, 8, 0);

  it('none no agenda nada', () => {
    expect(appointmentReminderDates(startsAt, 'none', now)).toEqual({
      reminderAtRaw: null,
      triggers: [],
      choice: 'none',
    });
  });

  it('day-before agenda 9:00 del día anterior', () => {
    const result = appointmentReminderDates(startsAt, 'day-before', now);
    expect(result.reminderAtRaw).toBe('2026-09-24T09:00:00');
    expect(result.triggers).toEqual([new Date(2026, 8, 24, 9, 0, 0, 0)]);
    expect(result.choice).toBe('day-before');
  });

  it('same-day agenda 9:00 del mismo día', () => {
    const result = appointmentReminderDates(startsAt, 'same-day', now);
    expect(result.reminderAtRaw).toBe('2026-09-25T09:00:00');
    expect(result.triggers).toEqual([new Date(2026, 8, 25, 9, 0, 0, 0)]);
    expect(result.choice).toBe('same-day');
  });

  it('both agenda día antes y mismo día', () => {
    const result = appointmentReminderDates(startsAt, 'both', now);
    expect(result.reminderAtRaw).toBe('2026-09-24T09:00:00');
    expect(result.triggers).toEqual([
      new Date(2026, 8, 24, 9, 0, 0, 0),
      new Date(2026, 8, 25, 9, 0, 0, 0),
    ]);
    expect(result.choice).toBe('both');
  });

  it('excluye fechas pasadas y reminderAtRaw null', () => {
    const lateNow = new Date(2026, 8, 25, 9, 30);
    const result = appointmentReminderDates(startsAt, 'both', lateNow);
    expect(result.triggers).toEqual([]);
    expect(result.reminderAtRaw).toBeNull();
  });

  it('excluye avisos dentro del margen de 1 minuto', () => {
    const nearNow = new Date(2026, 8, 24, 8, 59, 30);
    const result = appointmentReminderDates(startsAt, 'day-before', nearNow);
    expect(result.triggers).toEqual([]);
    expect(result.reminderAtRaw).toBeNull();
  });
});

describe('round-trip reminder_choice', () => {
  it('day-before directo devuelve day-before, no both del helper legacy', () => {
    const startsAt = new Date(2026, 8, 25, 10, 0);
    const now = new Date(2026, 8, 20, 8, 0);
    const { reminderAtRaw, choice } = appointmentReminderDates(startsAt, 'day-before', now);
    expect(choice).toBe('day-before');
    expect(reminderAtRaw).toBe('2026-09-24T09:00:00');
    expect(choiceFromReminderAt(reminderAtRaw, startsAt)).toBe('both');
  });
});

describe('birthdayNotificationDates', () => {
  it('none no agenda nada', () => {
    expect(birthdayNotificationDates(new Date(1990, 4, 12), 'none', new Date(2026, 0, 10))).toEqual(
      [],
    );
  });

  it('both agenda día antes y mismo día del próximo cumpleaños', () => {
    const result = birthdayNotificationDates(
      new Date(1990, 4, 12),
      'both',
      new Date(2026, 0, 10),
    );
    expect(result).toEqual([
      new Date(2026, 4, 11, 9, 0, 0, 0),
      new Date(2026, 4, 12, 9, 0, 0, 0),
    ]);
  });

  it('same-day agenda solo el mismo día', () => {
    const result = birthdayNotificationDates(
      new Date(1990, 4, 12),
      'same-day',
      new Date(2026, 0, 10),
    );
    expect(result).toEqual([new Date(2026, 4, 12, 9, 0, 0, 0)]);
  });

  it('respeta el horizonte', () => {
    const result = birthdayNotificationDates(
      new Date(1990, 4, 12),
      'both',
      new Date(2026, 11, 20),
      30,
    );
    expect(result).toEqual([]);
  });

  it('29-feb en año no bisiesto agenda 28-feb y 1-mar', () => {
    const result = birthdayNotificationDates(
      new Date(2024, 1, 29),
      'both',
      new Date(2026, 0, 10),
    );
    expect(result).toEqual([
      new Date(2026, 1, 28, 9, 0, 0, 0),
      new Date(2026, 2, 1, 9, 0, 0, 0),
    ]);
  });

  it('29-feb en año bisiesto agenda 28-feb y 29-feb', () => {
    const result = birthdayNotificationDates(
      new Date(2024, 1, 29),
      'both',
      new Date(2024, 0, 10),
    );
    expect(result).toEqual([
      new Date(2024, 1, 28, 9, 0, 0, 0),
      new Date(2024, 1, 29, 9, 0, 0, 0),
    ]);
  });
});

describe('choiceFromReminderAt', () => {
  const startsAt = new Date(2026, 8, 25, 10, 0);

  it('null → none', () => {
    expect(choiceFromReminderAt(null, startsAt)).toBe('none');
  });

  it('día antes → both', () => {
    expect(choiceFromReminderAt('2026-09-24T09:00:00', startsAt)).toBe('both');
  });

  it('mismo día → same-day', () => {
    expect(choiceFromReminderAt('2026-09-25T09:00:00', startsAt)).toBe('same-day');
  });
});

describe('slotForDate', () => {
  it('distingue día antes de mismo día', () => {
    expect(slotForDate(new Date(2026, 8, 24, 9, 0), '2026-09-25T10:00:00')).toBe('day-before');
    expect(slotForDate(new Date(2026, 8, 25, 9, 0), '2026-09-25T10:00:00')).toBe('same-day');
  });
});

describe('fingerprints', () => {
  it('cambian con starts_at', () => {
    const other = { ...appointment, starts_at: '2026-10-01T10:00:00' };
    expect(appointmentFingerprint(appointment, 'both')).not.toBe(
      appointmentFingerprint(other, 'both'),
    );
  });

  it('cambian con choice', () => {
    expect(appointmentFingerprint(appointment, 'day-before')).not.toBe(
      appointmentFingerprint(appointment, 'both'),
    );
  });

  it('cambian con birth_date', () => {
    const other = { ...contact, birth_date: '1991-06-01' };
    expect(birthdayFingerprint(contact, 'both')).not.toBe(birthdayFingerprint(other, 'both'));
  });
});

describe('notificationKey', () => {
  it('compone kind:id:slot', () => {
    expect(notificationKey('appointment', 'a1', 'day-before')).toBe('appointment:a1:day-before');
    expect(notificationKey('birthday', 'c1', 'same-day')).toBe('birthday:c1:same-day');
  });
});

describe('contenido de notificaciones', () => {
  it('buildAppointmentContent genera título y body', () => {
    const content = buildAppointmentContent(appointment, 'day-before');
    expect(content.title.length).toBeGreaterThan(0);
    expect(content.body.length).toBeGreaterThan(0);
    expect(content.data).toEqual({ type: 'appointment', id: 'a1', slot: 'day-before' });
  });

  it('buildBirthdayContent genera título y body', () => {
    const content = buildBirthdayContent(contact, 'same-day');
    expect(content.title.length).toBeGreaterThan(0);
    expect(content.body.length).toBeGreaterThan(0);
    expect(content.data).toEqual({ type: 'birthday', id: 'c1', slot: 'same-day' });
  });
});