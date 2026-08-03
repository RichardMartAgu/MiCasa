import {
  addDays,
  addMonths,
  daysBetween,
  formatDate,
  fromISODate,
  monthKey,
  startOfDay,
  toISODate,
  todayISO,
} from '@/lib/date';

describe('toISODate', () => {
  it('formatea la fecha como YYYY-MM-DD', () => {
    expect(toISODate(new Date(2026, 7, 3))).toBe('2026-08-03');
    expect(toISODate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('todayISO', () => {
  it('devuelve la fecha actual en ISO', () => {
    expect(todayISO()).toBe(toISODate(new Date()));
  });
});

describe('addDays / addMonths', () => {
  it('suma días', () => {
    expect(toISODate(addDays(new Date(2026, 7, 3), 5))).toBe('2026-08-08');
    expect(toISODate(addDays(new Date(2026, 7, 3), -3))).toBe('2026-07-31');
  });

  it('suma meses', () => {
    expect(toISODate(addMonths(new Date(2026, 7, 3), 1))).toBe('2026-09-03');
  });
});

describe('daysBetween', () => {
  it('calcula la diferencia en días entre fechas', () => {
    expect(daysBetween(new Date(2026, 7, 3), new Date(2026, 7, 10))).toBe(7);
    expect(daysBetween(new Date(2026, 7, 3), new Date(2026, 7, 3))).toBe(0);
    expect(daysBetween(new Date(2026, 7, 10), new Date(2026, 7, 3))).toBe(-7);
  });
});

describe('startOfDay', () => {
  it('pone la hora a medianoche', () => {
    const d = startOfDay(new Date(2026, 7, 3, 15, 30, 45));
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });
});

describe('monthKey', () => {
  it('devuelve AAAA-MM', () => {
    expect(monthKey(new Date(2026, 7, 3))).toBe('2026-08');
    expect(monthKey(new Date(2026, 0, 3))).toBe('2026-01');
  });
});

describe('fromISODate', () => {
  it('convierte una fecha ISO a Date local', () => {
    const d = fromISODate('2026-08-03');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(3);
  });
});

describe('formatDate', () => {
  it('devuelve una cadena vacía si la fecha no es válida', () => {
    expect(formatDate('no-es-fecha')).toBe('');
  });

  it('formatea fechas en español', () => {
    const result = formatDate('2026-08-03T10:00:00');
    expect(result).toContain('3 de agosto');
    expect(result).toContain('2026');
  });
});
