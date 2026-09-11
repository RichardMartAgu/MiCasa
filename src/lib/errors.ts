const RULES: { pattern: RegExp; message: string }[] = [
  { pattern: /Invalid login credentials/i, message: 'Correo o contraseña incorrectos.' },
  { pattern: /Email not confirmed/i, message: 'Confirma tu correo antes de iniciar sesión.' },
  { pattern: /already been registered/i, message: 'Ya existe una cuenta con ese correo.' },
  { pattern: /No existe ninguna casa con ese código/i, message: 'No existe ninguna casa con ese código.' },
  { pattern: /Debes iniciar sesión/i, message: 'Debes iniciar sesión.' },
  { pattern: /Network request failed|Failed to fetch/i, message: 'Problema de conexión. Inténtalo de nuevo.' },
  { pattern: /duplicate key value violates unique constraint/i, message: 'Ese registro ya existe.' },
  { pattern: /new row violates check constraint|violates check constraint/i, message: 'Algún dato no cumple las reglas de la aplicación.' },
];

const FALLBACK = 'Error desconocido. Inténtalo de nuevo.';

export function friendlyError(raw: string): string {
  for (const rule of RULES) {
    if (rule.pattern.test(raw)) return rule.message;
  }
  return FALLBACK;
}
