import { filterAppointments, filterContacts, filterExpenses } from '@/lib/filter';
import type { Appointment, Contact, Expense } from '@/lib/types';

function expense(overrides: Partial<Expense>): Expense {
  return {
    id: 'id',
    casa_id: 'casa',
    category_id: null,
    user_id: null,
    title: 'Gasto',
    amount: 0,
    spent_at: '2026-09-01T10:00:00',
    note: null,
    created_at: '2026-09-01T10:00:00',
    ...overrides,
  };
}

describe('filterExpenses', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('filtra por search con trim y case-insensitive', () => {
    const expenses = [
      expense({ id: '1', title: 'Supermercado' }),
      expense({ id: '2', title: 'Panadería' }),
      expense({ id: '3', title: '  SUPERMERCADO  ' }),
    ];
    const result = filterExpenses(expenses, { search: '  super ' });
    expect(result.map((e) => e.id)).toEqual(['1', '3']);
  });

  it('categoría vacía o ausente = sin filtro', () => {
    const expenses = [
      expense({ id: '1', category_id: 'a' }),
      expense({ id: '2', category_id: 'b' }),
    ];
    expect(filterExpenses(expenses, { categoryId: '' })).toHaveLength(2);
    expect(filterExpenses(expenses, {})).toHaveLength(2);
  });

  it('combina AND search + categoría + fecha', () => {
    jest.useFakeTimers({ now: new Date('2026-09-14T12:00:00') });
    const expenses = [
      expense({ id: '1', title: 'Pan', category_id: 'a', spent_at: '2026-09-01T10:00:00' }),
      expense({ id: '2', title: 'Pan', category_id: 'b', spent_at: '2026-09-01T10:00:00' }),
      expense({ id: '3', title: 'Leche', category_id: 'a', spent_at: '2026-09-01T10:00:00' }),
      expense({ id: '4', title: 'Pan', category_id: 'a', spent_at: '2026-08-01T10:00:00' }),
    ];
    const result = filterExpenses(expenses, {
      search: 'pan',
      categoryId: 'a',
      dateRange: 'this_month',
    });
    expect(result.map((e) => e.id)).toEqual(['1']);
  });

  it('this_month cruza borde de año (diciembre → enero)', () => {
    jest.useFakeTimers({ now: new Date('2027-01-15T12:00:00') });
    const expenses = [
      expense({ id: 'dec', spent_at: '2026-12-31T23:59:00' }),
      expense({ id: 'jan', spent_at: '2027-01-10T10:00:00' }),
      expense({ id: 'feb', spent_at: '2027-02-01T10:00:00' }),
    ];
    const result = filterExpenses(expenses, { dateRange: 'this_month' });
    expect(result.map((e) => e.id)).toEqual(['jan']);
  });

  it('this_year filtra por año actual', () => {
    jest.useFakeTimers({ now: new Date('2026-09-14T12:00:00') });
    const expenses = [
      expense({ id: '2025', spent_at: '2025-12-31T23:59:00' }),
      expense({ id: '2026a', spent_at: '2026-01-01T00:00:00' }),
      expense({ id: '2026b', spent_at: '2026-09-14T12:00:00' }),
    ];
    const result = filterExpenses(expenses, { dateRange: 'this_year' });
    expect(result.map((e) => e.id)).toEqual(['2026a', '2026b']);
  });

  it('last_3_months cruza borde de año (15 enero → 15 octubre año anterior)', () => {
    jest.useFakeTimers({ now: new Date('2027-01-15T12:00:00') });
    const expenses = [
      expense({ id: 'oct15', spent_at: '2026-10-15T00:00:00' }),
      expense({ id: 'oct14', spent_at: '2026-10-14T23:59:59' }),
      expense({ id: 'jan15', spent_at: '2027-01-15T12:00:00' }),
      expense({ id: 'sep', spent_at: '2026-09-30T10:00:00' }),
    ];
    const result = filterExpenses(expenses, { dateRange: 'last_3_months' });
    expect(result.map((e) => e.id)).toEqual(['oct15', 'jan15']);
  });

  it('dateRange all = sin filtro temporal', () => {
    const expenses = [
      expense({ id: 'old', spent_at: '2020-01-01T00:00:00' }),
      expense({ id: 'new', spent_at: '2026-09-01T00:00:00' }),
    ];
    expect(filterExpenses(expenses, { dateRange: 'all' })).toHaveLength(2);
  });

  it('descarta spent_at inválido', () => {
    jest.useFakeTimers({ now: new Date('2026-09-14T12:00:00') });
    const expenses = [
      expense({ id: 'valid', spent_at: '2026-09-01T10:00:00' }),
      expense({ id: 'invalid', spent_at: 'not-a-date' }),
    ];
    const result = filterExpenses(expenses, { dateRange: 'this_month' });
    expect(result.map((e) => e.id)).toEqual(['valid']);
  });

  it('sin filtros devuelve copia sin mutar el input', () => {
    const expenses = [expense({ id: '1' }), expense({ id: '2' })];
    const result = filterExpenses(expenses);
    expect(result).not.toBe(expenses);
    expect(result).toEqual(expenses);
    expect(expenses).toHaveLength(2);
  });
});

function appointment(overrides: Partial<Appointment>): Appointment {
  return {
    id: 'id',
    casa_id: 'casa',
    user_id: null,
    title: 'Cita',
    description: null,
    person: null,
    location: null,
    kind: 'medico',
    starts_at: '2026-09-20T10:00:00',
    reminder_at: null,
    reminder_choice: 'none',
    created_at: '2026-09-01T10:00:00',
    ...overrides,
  };
}

describe('filterAppointments', () => {
  it('filtra por search en title', () => {
    const appointments = [
      appointment({ id: '1', title: 'Pediatría de Leo' }),
      appointment({ id: '2', title: 'Dentista' }),
    ];
    const result = filterAppointments(appointments, { search: 'pediatría' });
    expect(result.map((a) => a.id)).toEqual(['1']);
  });

  it('search null-safe con person y location opcionales', () => {
    const appointments = [
      appointment({ id: '1', title: 'Cita', person: 'María', location: null }),
      appointment({ id: '2', title: 'Cita', person: null, location: 'Hospital Central' }),
      appointment({ id: '3', title: 'Cita', person: null, location: null }),
    ];
    expect(filterAppointments(appointments, { search: 'maría' }).map((a) => a.id)).toEqual(['1']);
    expect(filterAppointments(appointments, { search: 'hospital' }).map((a) => a.id)).toEqual(['2']);
    expect(filterAppointments(appointments, { search: 'cita' })).toHaveLength(3);
  });

  it('filtra por kind', () => {
    const appointments = [
      appointment({ id: '1', kind: 'medico' }),
      appointment({ id: '2', kind: 'escuela' }),
      appointment({ id: '3', kind: 'mascota' }),
    ];
    expect(filterAppointments(appointments, { kind: 'escuela' }).map((a) => a.id)).toEqual(['2']);
  });

  it('kind vacío o ausente = sin filtro', () => {
    const appointments = [
      appointment({ id: '1', kind: 'medico' }),
      appointment({ id: '2', kind: 'otro' }),
    ];
    expect(filterAppointments(appointments, { kind: '' })).toHaveLength(2);
    expect(filterAppointments(appointments, {})).toHaveLength(2);
  });

  it('combina AND search + kind', () => {
    const appointments = [
      appointment({ id: '1', title: 'Pediatría', kind: 'medico' }),
      appointment({ id: '2', title: 'Pediatría', kind: 'escuela' }),
      appointment({ id: '3', title: 'Dentista', kind: 'medico' }),
    ];
    const result = filterAppointments(appointments, { search: 'pediatría', kind: 'medico' });
    expect(result.map((a) => a.id)).toEqual(['1']);
  });

  it('sin filtros devuelve copia sin mutar el input', () => {
    const appointments = [appointment({ id: '1' }), appointment({ id: '2' })];
    const result = filterAppointments(appointments);
    expect(result).not.toBe(appointments);
    expect(result).toEqual(appointments);
    expect(appointments).toHaveLength(2);
  });
});

function contact(overrides: Partial<Contact>): Contact {
  return {
    id: 'id',
    casa_id: 'casa',
    user_id: null,
    name: 'Contacto',
    birth_date: '1990-05-10',
    relationship: null,
    phone: null,
    created_at: '2026-09-01T10:00:00',
    ...overrides,
  };
}

describe('filterContacts', () => {
  it('filtra por search en name con trim y case-insensitive', () => {
    const contacts = [
      contact({ id: '1', name: 'María López' }),
      contact({ id: '2', name: '  maría garcía  ' }),
      contact({ id: '3', name: 'Pedro' }),
    ];
    const result = filterContacts(contacts, { search: '  maría ' });
    expect(result.map((c) => c.id)).toEqual(['1', '2']);
  });

  it('filtra por relationship', () => {
    const contacts = [
      contact({ id: '1', relationship: 'Hijo/a' }),
      contact({ id: '2', relationship: 'Mamá' }),
    ];
    expect(filterContacts(contacts, { relationship: 'Mamá' }).map((c) => c.id)).toEqual(['2']);
  });

  it('relationship null no crashea y no aparece con filtro activo', () => {
    const contacts = [
      contact({ id: '1', relationship: null }),
      contact({ id: '2', relationship: 'Mamá' }),
    ];
    expect(filterContacts(contacts, { relationship: 'Mamá' }).map((c) => c.id)).toEqual(['2']);
    expect(filterContacts(contacts, { search: 'contacto' })).toHaveLength(2);
  });

  it('relationship vacío o ausente = sin filtro', () => {
    const contacts = [
      contact({ id: '1', relationship: 'Mamá' }),
      contact({ id: '2', relationship: null }),
    ];
    expect(filterContacts(contacts, { relationship: '' })).toHaveLength(2);
    expect(filterContacts(contacts, {})).toHaveLength(2);
  });

  it('combina AND search + relationship', () => {
    const contacts = [
      contact({ id: '1', name: 'Leo', relationship: 'Hijo/a' }),
      contact({ id: '2', name: 'Leo', relationship: 'Mamá' }),
      contact({ id: '3', name: 'Ana', relationship: 'Hijo/a' }),
    ];
    const result = filterContacts(contacts, { search: 'leo', relationship: 'Hijo/a' });
    expect(result.map((c) => c.id)).toEqual(['1']);
  });

  it('sin filtros devuelve copia sin mutar el input', () => {
    const contacts = [contact({ id: '1' }), contact({ id: '2' })];
    const result = filterContacts(contacts);
    expect(result).not.toBe(contacts);
    expect(result).toEqual(contacts);
    expect(contacts).toHaveLength(2);
  });

  it('normaliza trim de relationship para matchear chips', () => {
    const contacts = [
      contact({ id: '1', relationship: ' Mamá ' }),
      contact({ id: '2', relationship: 'Mamá' }),
    ];
    expect(filterContacts(contacts, { relationship: 'Mamá' }).map((c) => c.id)).toEqual(['1', '2']);
  });
});