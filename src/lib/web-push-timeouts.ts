/**
 * Reparto de topes de tiempo del alta de avisos.
 *
 * Vive aparte de `web-push.ts` y no importa nada por dos motivos concretos, no
 * por elegancia:
 *
 * 1. `web-push.ts` crea un cliente de Supabase al cargarse, así que un test que
 *    necesite estos números **de verdad** no puede importarlo: se lleva por
 *    delante la comprobación de variables de entorno y revienta. Con este módulo
 *    no pasa: no tiene dependencias.
 * 2. Los números son un acuerdo, y un acuerdo necesita una sola fuente. Estaban
 *    duplicados como literales en el mock de los tests de Ajustes y en el avance
 *    de temporizadores; al subir `ACTIVATION_TIMEOUT_MS` de 30 a 35 s, el mock se
 *    quedó corto y el test siguió pasando por no agotar el tiempo, sin comprobar
 *    nada. El mock y los timers leen de aquí.
 */

/** El diálogo de permisos espera a una persona: holgado a propósito. */
export const PERMISSION_TIMEOUT_MS = 65_000;

/** Una fase del registro o la activación del service worker. */
export const SW_READY_TIMEOUT_MS = 10_000;

/**
 * El alta completa: registro, suscripción, espera de las claves y escritura.
 *
 * Subió de 30 a 35 s para pagar la espera de las claves. Con 30 no había margen:
 * el registro del worker puede gastar hasta 20 s (dos fases de
 * `SW_READY_TIMEOUT_MS`) y para FCM, la red y la espera quedaban ~7 s, con lo que
 * el corte saltaba más a menudo y la persona veía "no ha terminado a tiempo" en
 * lugar del motivo real. Y como el tope no cancela el trabajo pendiente, un alta
 * que acabara tarde insertaba la fila después de que la interfaz ya hubiera dicho
 * que no terminó.
 *
 * `CLAVES_TIMEOUT_MS` subió a 30 s: en algunos Redmi/Xiaomi FCM puede tardar
 * 20+ segundos en generar `p256dh`/`auth` tras el `subscribe()`. El bucle
 * reintenta cada `CLAVES_PASO_MS` (3 s) hasta el tope.
 */
export const ACTIVATION_TIMEOUT_MS = 60_000;

/** Cuánto se espera a que el navegador rellene las claves de cifrado. */
export const CLAVES_TIMEOUT_MS = 30_000;

/** Pausa entre relecturas durante esa espera. */
export const CLAVES_PASO_MS = 3_000;

/**
 * Lectura de la preferencia de cumpleaños que vive en `push_preferences`.
 *
 * Es una fila y una columna, así que por peso de operación no le haría falta
 * ningún tope; lo tiene por lo que cuesta en pantalla. Ajustes espera esta
 * lectura antes de habilitar el interruptor, así que una petición que no recibe
 * respuesta lo dejaría bloqueado hasta recargar la página: exactamente el fallo
 * que este módulo promete no dejar. Cinco segundos dan de sobra para un viaje de
 * ida y vuelta en red móvil; a partir de ahí lo que hay que arreglar es la red.
 */
export const PREFS_READ_TIMEOUT_MS = 5_000;

/** Tope global de la pantalla de Ajustes: la suma de los dos con margen. */
export const WEB_PUSH_TIMEOUT_MS = PERMISSION_TIMEOUT_MS + ACTIVATION_TIMEOUT_MS + 10_000;
