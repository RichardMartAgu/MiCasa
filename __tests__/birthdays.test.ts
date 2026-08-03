import { ageOn, birthdayLabel, nextBirthday, upcomingBirthdays } from '@/lib/birthdays';
import type { Contact } from '@/lib/types';

function contact(overrides: Partial<Contact>): Contact {
  return {
    id: 'id',
    casa_id: 'casa',
    user_id: null,
    name: 'Contacto',
    birth_date: '1990-05-15',
    relationship: null,
    phone: null,
    created_at: '',
    ...overrides,
  };
}

describe('ageOn', () => {
  it('calcula la edad cumplida', () => {
    const birth = new Date(1990, 4, 15);
    expect(ageOn(birth, new Date(2026, 7, 3))).toBe(36);
  });

  it('no cuenta el año si el cumpleaños aún no ha pasado', () => {
    const birth = new Date(1990, 10, 15);
    expect(ageOn(birth, new Date(2026, 7, 3))).toBe(35);
  });
});

describe('nextBirthday', () => {
  it('devuelve el cumpleaños de este año si aún no ha pasado', () => {
    const next = nextBirthday(new Date(1990, 4, 15), new Date(2026, 7, 3));
    expect(next).toEqual(new Date(2027, 4, 15));
  });

  it('devuelve el de este año si el cumpleaños es hoy', () => {
    const next = nextBirthday(new Date(1990, 7, 3), new Date(2026, 7, 3));
    expect(next).toEqual(new Date(2026, 7, 3));
  });
});

describe('upcomingBirthdays', () => {
  it('solo devuelve los cumpleaños dentro del horizonte', () => {
    const from = new Date(2026, 7, 3);
    const contacts = [
      contact({ id: '1', name: 'Ana', birth_date: '1990-08-10' }),
      contact({ id: '2', name: 'Leo', birth_date: '2015-09-01' }),
      contact({ id: '3', name: 'Luna', birth_date: '2018-12-25' }),
    ];
    const upcoming = upcomingBirthdays(contacts, from, 30);
    expect(upcoming.map((u) => u.contact.name)).toEqual(['Ana', 'Leo']);
    expect(upcoming[0].daysUntil).toBe(7);
    expect(upcoming[1].daysUntil).toBe(29);
  });

  it('incluye los cumpleaños de hoy con días 0', () => {
    const from = new Date(2026, 7, 3);
    const contacts = [contact({ id: '1', name: 'Hoy', birth_date: '1990-08-03' })];
    const upcoming = upcomingBirthdays(contacts, from, 30);
    expect(upcoming[0].daysUntil).toBe(0);
    expect(upcoming[0].age).toBe(36);
  });

  it('ordena por cercanía', () => {
    const from = new Date(2026, 7, 3);
    const contacts = [
      contact({ id: '1', name: 'Lejos', birth_date: '1990-08-20' }),
      contact({ id: '2', name: 'Cerca', birth_date: '1990-08-06' }),
    ];
    const upcoming = upcomingBirthdays(contacts, from, 30);
    expect(upcoming.map((u) => u.contact.name)).toEqual(['Cerca', 'Lejos']);
  });

  it('ignora contactos con fecha inválida', () => {
    const from = new Date(2026, 7, 3);
    const contacts = [contact({ id: '1', name: 'Roto', birth_date: 'fecha-mala' })];
    expect(upcomingBirthdays(contacts, from, 30)).toEqual([]);
  });
});

describe('birthdayLabel', () => {
  it('distingue hoy, mañana y fechas lejanas', () => {
    expect(birthdayLabel(0)).toBe('Hoy');
    expect(birthdayLabel(1)).toBe('Mañana');
    expect(birthdayLabel(5)).toContain('5');
  });
});
