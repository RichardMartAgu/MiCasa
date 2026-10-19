import { fridgeDaysLeft, fridgeExpiryLabel, isFridgeExpired } from '@/lib/fridge';

const TODAY = new Date(2026, 2, 16, 12, 0, 0);

describe('fridgeDaysLeft', () => {
  it('cuenta días de calendario, no horas', () => {
    expect(fridgeDaysLeft('2026-03-16', TODAY)).toBe(0);
    expect(fridgeDaysLeft('2026-03-17', TODAY)).toBe(1);
    expect(fridgeDaysLeft('2026-03-18', TODAY)).toBe(2);
    expect(fridgeDaysLeft('2026-03-15', TODAY)).toBe(-1);
  });

  it('devuelve null con fecha inválida', () => {
    expect(fridgeDaysLeft('2026-02-30', TODAY)).toBeNull();
    expect(fridgeDaysLeft('ayer', TODAY)).toBeNull();
  });
});

describe('isFridgeExpired', () => {
  it('solo marca días anteriores a hoy', () => {
    expect(isFridgeExpired('2026-03-15', TODAY)).toBe(true);
    expect(isFridgeExpired('2026-03-16', TODAY)).toBe(false);
    expect(isFridgeExpired('2026-03-17', TODAY)).toBe(false);
  });
});

describe('fridgeExpiryLabel', () => {
  it.each([
    ['2026-03-14', 'Caducó hace 2 días'],
    ['2026-03-15', 'Caducó ayer'],
    ['2026-03-16', 'Caduca hoy'],
    ['2026-03-17', 'Caduca mañana'],
    ['2026-03-18', 'Caduca en 2 días'],
  ])('%s → %s', (date, label) => {
    expect(fridgeExpiryLabel(date, TODAY)).toBe(label);
  });

  it('no inventa una fecha ilegible', () => {
    expect(fridgeExpiryLabel('', TODAY)).toBe('Fecha no válida');
  });
});
