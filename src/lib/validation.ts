export type ValidationResult =
  | { valid: true }
  | { valid: false; message: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_CODE_RE = /^[A-Z0-9]{8}$/;

export function validateEmail(value: string): ValidationResult {
  const email = value.trim();
  if (!email) return { valid: false, message: 'El correo es obligatorio.' };
  if (!EMAIL_RE.test(email))
    return { valid: false, message: 'El correo no tiene un formato válido.' };
  return { valid: true };
}

export function validatePassword(value: string): ValidationResult {
  if (!value) return { valid: false, message: 'La contraseña es obligatoria.' };
  if (value.length < 6)
    return {
      valid: false,
      message: 'La contraseña debe tener al menos 6 caracteres.',
    };
  return { valid: true };
}

export function validateDisplayName(value: string): ValidationResult {
  const name = value.trim();
  if (!name) return { valid: false, message: 'El nombre es obligatorio.' };
  if (name.length > 40)
    return { valid: false, message: 'El nombre no puede superar 40 caracteres.' };
  return { valid: true };
}

export function validateCasaName(value: string): ValidationResult {
  const name = value.trim();
  if (!name) return { valid: false, message: 'El nombre de la casa es obligatorio.' };
  if (name.length > 60)
    return { valid: false, message: 'El nombre no puede superar 60 caracteres.' };
  return { valid: true };
}

export function validateInviteCode(value: string): ValidationResult {
  const code = value.trim().toUpperCase();
  if (!code) return { valid: false, message: 'Introduce el código de invitación.' };
  if (!INVITE_CODE_RE.test(code))
    return {
      valid: false,
      message: 'El código debe tener 8 caracteres alfanuméricos.',
    };
  return { valid: true };
}

export function validateTitle(value: string): ValidationResult {
  const title = value.trim();
  if (!title) return { valid: false, message: 'El título es obligatorio.' };
  if (title.length > 120)
    return { valid: false, message: 'El título no puede superar 120 caracteres.' };
  return { valid: true };
}

export function validateAmount(value: number): ValidationResult {
  if (!Number.isFinite(value)) return { valid: false, message: 'Importe no válido.' };
  if (value <= 0) return { valid: false, message: 'El importe debe ser mayor que 0.' };
  return { valid: true };
}

export function validateDate(value: string): ValidationResult {
  if (!value) return { valid: false, message: 'La fecha es obligatoria.' };
  if (Number.isNaN(Date.parse(value)))
    return { valid: false, message: 'La fecha no es válida.' };
  return { valid: true };
}

export function validateBudget(value: number | null | undefined): ValidationResult {
  if (value === null || value === undefined) return { valid: true };
  if (!Number.isFinite(value)) return { valid: false, message: 'Presupuesto no válido.' };
  if (value < 0) return { valid: false, message: 'El presupuesto no puede ser negativo.' };
  return { valid: true };
}

export function validateOptionalText(value: string, max: number): ValidationResult {
  const text = value.trim();
  if (text.length > max)
    return { valid: false, message: `No puede superar ${max} caracteres.` };
  return { valid: true };
}
