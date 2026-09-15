import {
  validateAmount,
  validateBudget,
  validateCasaName,
  validateDate,
  validateDisplayName,
  validateEmail,
  validateInviteCode,
  validateOptionalText,
  validatePassword,
  validateTitle,
} from '@/lib/validation';

describe('validateEmail', () => {
  it('acepta un correo válido', () => {
    expect(validateEmail('ana@casa.com')).toEqual({ valid: true });
  });

  it('rechaza un correo vacío', () => {
    expect(validateEmail('')).toEqual({ valid: false, message: 'El correo es obligatorio.' });
  });

  it('rechaza un correo sin formato', () => {
    expect(validateEmail('ana@casa')).toHaveProperty('valid', false);
    expect(validateEmail('ana')).toHaveProperty('valid', false);
  });
});

describe('validatePassword', () => {
  it('acepta una contraseña de 6+ caracteres', () => {
    expect(validatePassword('123456')).toEqual({ valid: true });
  });

  it('rechaza contraseñas cortas', () => {
    expect(validatePassword('123')).toMatchObject({ valid: false });
  });

  it('rechaza contraseñas vacías', () => {
    expect(validatePassword('')).toMatchObject({ valid: false });
  });
});

describe('validateDisplayName', () => {
  it('acepta un nombre normal', () => {
    expect(validateDisplayName('Ana García')).toEqual({ valid: true });
  });

  it('recorta espacios y rechaza vacío', () => {
    expect(validateDisplayName('   ')).toMatchObject({ valid: false });
    expect(validateDisplayName('Ana')).toEqual({ valid: true });
  });

  it('rechaza nombres demasiado largos', () => {
    expect(validateDisplayName('a'.repeat(41))).toMatchObject({ valid: false });
  });
});

describe('validateCasaName', () => {
  it('acepta un nombre de casa', () => {
    expect(validateCasaName('Mi Hogar')).toEqual({ valid: true });
  });

  it('rechaza vacío', () => {
    expect(validateCasaName('')).toMatchObject({ valid: false });
  });
});

describe('validateInviteCode', () => {
  it('acepta códigos de 16 caracteres hexadecimales', () => {
    expect(validateInviteCode('ABCDEF0123456789')).toEqual({ valid: true });
    expect(validateInviteCode('abcdef0123456789')).toEqual({ valid: true });
  });

  it('rechaza códigos con formato incorrecto', () => {
    expect(validateInviteCode('ABCD1234')).toMatchObject({ valid: false });
    expect(validateInviteCode('ABC')).toMatchObject({ valid: false });
    expect(validateInviteCode('AB CD 12')).toMatchObject({ valid: false });
    expect(validateInviteCode('')).toMatchObject({ valid: false });
  });
});

describe('validateTitle', () => {
  it('acepta un título', () => {
    expect(validateTitle('Pediatría')).toEqual({ valid: true });
  });

  it('rechaza vacío', () => {
    expect(validateTitle('  ')).toMatchObject({ valid: false });
  });
});

describe('validateAmount', () => {
  it('acepta importes positivos', () => {
    expect(validateAmount(12.5)).toEqual({ valid: true });
  });

  it('rechaza cero, negativos y no numéricos', () => {
    expect(validateAmount(0)).toMatchObject({ valid: false });
    expect(validateAmount(-5)).toMatchObject({ valid: false });
    expect(validateAmount(NaN)).toMatchObject({ valid: false });
  });
});

describe('validateBudget', () => {
  it('acepta presupuestos vacíos', () => {
    expect(validateBudget(null)).toEqual({ valid: true });
    expect(validateBudget(undefined)).toEqual({ valid: true });
  });

  it('acepta presupuestos positivos', () => {
    expect(validateBudget(100)).toEqual({ valid: true });
  });

  it('rechaza negativos', () => {
    expect(validateBudget(-1)).toMatchObject({ valid: false });
  });
});

describe('validateDate', () => {
  it('acepta fechas ISO válidas', () => {
    expect(validateDate('2026-08-03T10:00:00')).toEqual({ valid: true });
  });

  it('rechaza fechas inválidas', () => {
    expect(validateDate('no-es-fecha')).toMatchObject({ valid: false });
    expect(validateDate('')).toMatchObject({ valid: false });
  });
});

describe('validateOptionalText', () => {
  it('acepta vacío y texto dentro del límite', () => {
    expect(validateOptionalText('', 120)).toEqual({ valid: true });
    expect(validateOptionalText('  ', 120)).toEqual({ valid: true });
    expect(validateOptionalText('Hola', 120)).toEqual({ valid: true });
  });

  it('rechaza texto que supera el límite', () => {
    expect(validateOptionalText('x'.repeat(121), 120)).toMatchObject({ valid: false });
  });
});
