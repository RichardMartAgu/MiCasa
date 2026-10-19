import { daysBetween, safeDate } from './date';

/**
 * Días que quedan hasta la caducidad, contando por días de calendario.
 * `null` si la fecha guardada no es válida.
 */
export function fridgeDaysLeft(expiryDate: string, today = new Date()): number | null {
  const expiry = safeDate(expiryDate);
  if (expiry === null) return null;
  return daysBetween(today, expiry);
}

export function isFridgeExpired(expiryDate: string, today = new Date()): boolean {
  const days = fridgeDaysLeft(expiryDate, today);
  return days !== null && days < 0;
}

/**
 * Texto de estado para la lista: "Caduca hoy", "Caduca mañana", "Caducó hace 2
 * días", "Caduca en 5 días".
 */
export function fridgeExpiryLabel(expiryDate: string, today = new Date()): string {
  const days = fridgeDaysLeft(expiryDate, today);
  if (days === null) return 'Fecha no válida';
  if (days < -1) return `Caducó hace ${-days} días`;
  if (days === -1) return 'Caducó ayer';
  if (days === 0) return 'Caduca hoy';
  if (days === 1) return 'Caduca mañana';
  return `Caduca en ${days} días`;
}
