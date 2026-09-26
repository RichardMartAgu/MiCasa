/**
 * Tope de tiempo para una operación que puede quedarse colgada sin rechazar.
 *
 * Un `await` sin techo es el fallo más caro que puede tener una interfaz: el
 * estado de "en curso" no se limpia nunca y el control queda inutilizable hasta
 * recargar la página. En móvil hay tres sitios donde eso pasa de verdad:
 * `Notification.requestPermission()` esperando a que la persona conteste el
 * diálogo nativo, `pushManager.subscribe()` esperando a FCM en un dispositivo
 * sin Play Services, y una petición a Supabase que no recibe respuesta.
 *
 * El temporizador no cancela el trabajo pendiente, solo deja de esperar por él:
 * un `requestPermission` o un `insert` que lleguen tarde siguen haciendo su
 * efecto, y quien llama puede desbloquear la interfaz mientras tanto. Por eso
 * el error va con un motivo legible, para que el aviso que muestre la interfaz
 * diga qué se quedó esperando y no un genérico "algo ha fallado".
 */

export class TimeoutError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'TimeoutError';
  }
}

/** Distingue el corte por tope de un fallo real, para poder explicarlos distinto. */
export function isTimeout(error: unknown): error is TimeoutError {
  return error instanceof TimeoutError;
}

export function withTimeout<T>(task: Promise<T>, ms: number, reason: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(reason)), ms);
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
