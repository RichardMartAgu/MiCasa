import { formatCurrency, formatInviteCode, initials } from '@/lib/format';

describe('formatCurrency', () => {
  it('formatea en euros', () => {
    expect(formatCurrency(12.5)).toContain('12,50');
    expect(formatCurrency(12.5)).toContain('€');
  });
});

describe('formatInviteCode', () => {
  it('convierte a mayúsculas', () => {
    expect(formatInviteCode('abcd1234')).toBe('ABCD1234');
  });
});

describe('initials', () => {
  it('devuelve las iniciales de nombre y apellido', () => {
    expect(initials('Ana García')).toBe('AG');
    expect(initials('ana')).toBe('A');
    expect(initials('')).toBe('');
  });
});
