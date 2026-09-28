import {
  parseDateInput,
  parseTimeInput,
  toDateInputValue,
  toTimeInputValue,
} from '@/components/ui/app-date-picker/index.web';

describe('AppDatePicker web (helpers)', () => {
  it('toDateInputValue formatea YYYY-MM-DD local', () => {
    expect(toDateInputValue(new Date(2026, 8, 5))).toBe('2026-09-05');
  });

  it('toTimeInputValue formatea HH:mm local', () => {
    expect(toTimeInputValue(new Date(2026, 8, 5, 9, 7))).toBe('09:07');
  });

  it('parseDateInput convierte a Date local sin shift UTC', () => {
    const date = parseDateInput('2026-09-05');
    expect(date).not.toBeNull();
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(8);
    expect(date?.getDate()).toBe(5);
    expect(date?.getHours()).toBe(0);
  });

  it('parseDateInput rechaza input inválido', () => {
    expect(parseDateInput('')).toBeNull();
    expect(parseDateInput('2026-13-01')).toBeNull();
    expect(parseDateInput('2026-09-32')).toBeNull();
    expect(parseDateInput('2026-09')).toBeNull();
    expect(parseDateInput('abc')).toBeNull();
    expect(parseDateInput('1899-09-05')).toBeNull();
    expect(parseDateInput('2101-09-05')).toBeNull();
    expect(parseDateInput('2026-00-05')).toBeNull();
    expect(parseDateInput('2026-09-00')).toBeNull();
    expect(parseDateInput('2026-02-31')).toBeNull();
    expect(parseDateInput('2026-04-31')).toBeNull();
    expect(parseDateInput('2026-09-05-extra')).toBeNull();
  });

  it('parseTimeInput copia horas/minutos preservando fecha base', () => {
    const base = new Date(2026, 8, 21, 8, 15);
    const time = parseTimeInput('17:45', base);
    expect(time).not.toBeNull();
    expect(time?.getFullYear()).toBe(2026);
    expect(time?.getMonth()).toBe(8);
    expect(time?.getDate()).toBe(21);
    expect(time?.getHours()).toBe(17);
    expect(time?.getMinutes()).toBe(45);
  });

  it('parseTimeInput rechaza horas/minutos fuera de rango', () => {
    const base = new Date(2026, 8, 21);
    expect(parseTimeInput('24:00', base)).toBeNull();
    expect(parseTimeInput('12:60', base)).toBeNull();
    expect(parseTimeInput('-1:30', base)).toBeNull();
    expect(parseTimeInput('12:-1', base)).toBeNull();
    expect(parseTimeInput('12', base)).toBeNull();
    expect(parseTimeInput('abc', base)).toBeNull();
    expect(parseTimeInput('12:30:45', base)).toBeNull();
  });
});