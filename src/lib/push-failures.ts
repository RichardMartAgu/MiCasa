/**
 * Por qué el navegador no ha creado la suscripción.
 *
 * Esto es lo que pasa cuando se pulsa "Activar notificaciones" y el navegador
 * dice que no. Sin esto, el mensaje que se leía era el del navegador, en inglés
 * y sin decir qué hacer: "Registration failed - push service not available", que
 * no es un motivo, es un síntoma. Medido en un Chromium real, que es exactamente
 * lo que devuelve: `AbortError` con ese texto.
 *
 * Los motivos van en la clave del registro de diagnóstico, así que se puede leer
 * en la base cuántos fallos de cada tipo hay sin depender de que nadie describa
 * lo que ve.
 */

export type SubscribeFailure =
  | 'sin-servicio-push'
  | 'permiso'
  | 'worker-inactivo'
  | 'clave-invalida'
  | 'desconocido';

/**
 * El motivo de un fallo de `pushManager.subscribe()`.
 *
 * Se decide por el nombre del error y no por el texto: el texto lo escribe
 * Chrome y cambia entre versiones, mientras que los nombres de DOM son
 * estándar. El texto solo se mira para separar dos casos de `AbortError` que se
 * confunden.
 */
export function classifySubscribeFailure(
  error: unknown,
  permission?: NotificationPermission,
): SubscribeFailure {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message.toLowerCase() : '';

  if (name === 'NotAllowedError' || message.includes('permission')) return 'permiso';
  if (name === 'InvalidStateError') return 'worker-inactivo';
  // `TypeError` con una `applicationServerKey` mal formada es un bug nuestro, no
  // del dispositivo, y conviene que se lea distinto de un fallo de red.
  if (name === 'TypeError' || message.includes('applicationserverkey')) return 'clave-invalida';
  if (name === 'AbortError' || message.includes('push service')) {
    // Con el permiso denegado, Chrome también devuelve `AbortError`: el detalle
    // está en el permiso, no en el servicio. Sin mirar los dos, se le dice a
    // alguien que actualice Play Services cuando lo que tiene es el permiso
    // denegado en el navegador.
    if (permission === 'denied') return 'permiso';
    return 'sin-servicio-push';
  }
  return 'desconocido';
}

/**
 * Qué se le dice a la persona, uno por cada motivo.
 *
 * "Actualiza los servicios de Google Play" aparece porque es la causa más
 * frecuente en un Android: sin ellos, o con ellos desactualizados, Chrome no
 * tiene por dónde registrar la suscripción y el alta falla sin que se pueda
 * arreglar desde la web.
 */
export const SUBSCRIBE_FAILURE_MESSAGES: Record<SubscribeFailure, string> = {
  'sin-servicio-push':
    'El navegador no ha podido connectarse con el servicio de avisos de Google. Suele ser que los servicios de Google Play estén desactivados, desactualizados o no disponibles en este móvil, o que la red los bloquee. Comprueba que Play Store y Play Services funcionan, actualiza el navegador y vuelve a intentarlo.',
  permiso:
    'El navegador no permite avisos en este sitio. Actívalo desde los ajustes del navegador (el icono del candado junto a la dirección) y vuelve a intentarlo.',
  'worker-inactivo':
    'El service worker todavía no está listo. Recarga la página y vuelve a intentarlo; a veces basta con abrirla otra vez.',
  'clave-invalida':
    'La configuración de los avisos en el servidor no es válida. Es un problema nuestro, no del móvil: escríbenos y lo miramos.',
  desconocido:
    'El navegador no ha podido activar los avisos. Prueba a recargar la página y volver a intentarlo.',
};
