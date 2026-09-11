import { friendlyError } from '@/lib/errors';

describe('friendlyError', () => {
  it('traduce credenciales inválidas', () => {
    expect(friendlyError('Invalid login credentials')).toBe(
      'Correo o contraseña incorrectos.',
    );
  });

  it('traduce correo sin confirmar', () => {
    expect(friendlyError('Email not confirmed')).toBe(
      'Confirma tu correo antes de iniciar sesión.',
    );
  });

  it('traduce correo ya registrado', () => {
    expect(friendlyError('User already been registered')).toBe(
      'Ya existe una cuenta con ese correo.',
    );
  });

  it('traduce código de casa inexistente', () => {
    expect(friendlyError('No existe ninguna casa con ese código')).toBe(
      'No existe ninguna casa con ese código.',
    );
  });

  it('traduce error de sesión', () => {
    expect(friendlyError('Debes iniciar sesión')).toBe('Debes iniciar sesión.');
  });

  it('traduce errores de red', () => {
    expect(friendlyError('Network request failed')).toBe(
      'Problema de conexión. Inténtalo de nuevo.',
    );
    expect(friendlyError('Failed to fetch')).toBe(
      'Problema de conexión. Inténtalo de nuevo.',
    );
  });

  it('traduce claves duplicadas', () => {
    expect(friendlyError('duplicate key value violates unique constraint')).toBe(
      'Ese registro ya existe.',
    );
  });

  it('traduce violaciones de check constraint', () => {
    expect(friendlyError('new row violates check constraint')).toBe(
      'Algún dato no cumple las reglas de la aplicación.',
    );
  });

  it('devuelve mensaje genérico para errores desconocidos', () => {
    expect(friendlyError('relation "public.secret_table" does not exist')).toBe(
      'Error desconocido. Inténtalo de nuevo.',
    );
  });

  it('devuelve mensaje genérico para strings vacíos', () => {
    expect(friendlyError('')).toBe('Error desconocido. Inténtalo de nuevo.');
  });

  it('es case-insensitive', () => {
    expect(friendlyError('INVALID LOGIN CREDENTIALS')).toBe(
      'Correo o contraseña incorrectos.',
    );
  });
});