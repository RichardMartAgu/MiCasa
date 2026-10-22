/**
 * Audiencia de un aviso: solo quien creó la fila o toda la casa.
 *
 * Vive en una constante y no en un booleano suelto porque el valor viaja a la
 * base de datos, al cron y a las notificaciones locales, y los tres tienen que
 * entender lo mismo. Un valor desconocido se trata como "me": el repliegue
 * seguro es no ampliar la audiencia de un aviso que no se sabe leer.
 */
export type NotifyAudience = 'me' | 'all';

export const notifyAudiences = ['me', 'all'] as const;

export const notifyAudienceLabels: Record<NotifyAudience, string> = {
  me: 'Solo yo',
  all: 'Toda la casa',
};

export function isValidNotifyAudience(value: unknown): value is NotifyAudience {
  return value === 'me' || value === 'all';
}

/**
 * ¿Este aviso debe verse en el dispositivo de `viewerId`?
 *
 * `all` se muestra a cualquier miembro; `me`, y cualquier valor ilegible, solo al
 * autor. Sin `viewerId` no se concede audiencia: un llamador que olvide el usuario
 * pierde avisos, pero nunca enseña los de otra persona.
 */
export function isAudienceVisible(
  row: { user_id?: string | null; notify_audience?: string | null },
  viewerId?: string | null,
): boolean {
  // Sin viewer no hay audiencia que conceder: fail-closed. Antes devolvía true
  // y eso fue la fuga que el bloque intentaba cerrar. Quien llame sin viewer
  // (tests antiguos) pasa uno explícito.
  if (!viewerId) return false;
  if (row.notify_audience === 'all') return true;
  return row.user_id === viewerId;
}
