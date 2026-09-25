# Web Push — recordatorios en la web

Estado: **implementado y verificado en código y en producción. Pendiente: PR, deploy y prueba en un navegador real.**

## Qué resuelve

En nativo los recordatorios los programa `expo-notifications` en el dispositivo. En web ese módulo no existe: `src/lib/notifications.ts` hace `if (Platform.OS === 'web') return` en todas sus funciones. Esta implementación sustituye ese hueco con Web Push: el navegador recibe los avisos aunque la app esté cerrada.

Sin instalar: funciona en Android (Chrome) y escritorio (Chrome/Edge/Firefox) abriendo la web en una pestaña normal. En iPhone **no**: Web Push en Safari exige iOS 16.4+ y la app instalada en la pantalla de inicio.

## Decisión de alcance

El usuario eligió **recordatorios programados desde el servidor**, no avisos de eventos en vivo ni push solo con la pestaña abierta. Motivo: es lo más parecido a lo que ya hace la app nativa, y es lo que funciona con la app cerrada.

## Arquitectura

```
Cliente (web)                         Supabase
─────────────                         ────────
Ajustes → interruptor
  → Notification.requestPermission()
  → PushManager.subscribe(VAPID)
  → push_subscriptions  ──────────►  RLS: solo lo propio
  → push_preferences   ──────────►  RLS: solo lo propio

pg_cron (cada 5 min) → pg_net → Edge Function send-web-push
                                        ├─ lee secretos de Vault
                                        ├─ calcula recordatorios pendientes
                                        ├─ push_log (idempotencia)
                                        └─ web-push firmado con VAPID ──► navegador
```

El service worker (`sw-src.js`) solo precachea el shell y atiende `push` y `notificationclick`. **No hay `runtimeCaching`**: los datos del usuario van siempre a Supabase y nunca se guardan en el Service Worker.

## Ficheros

| Archivo | Qué hace |
|---|---|
| `supabase/migrations/20260925_web_push.sql` | Tablas `push_subscriptions`, `push_preferences`, `push_log` con RLS de "solo lo propio", índices y el trigger de `updated_at`. |
| `supabase/migrations/20260925_web_push_trigger_hardening.sql` | `touch_updated_at` con `search_path` fijo y sin EXECUTE para anon/authenticated. |
| `supabase/migrations/20260925_web_push_cron.sql` | RPC `push_service_secret(text)`, trigger `protect_push_subscription_state`, revoke del RPC viejo y `cron.schedule` del dispatcher. |
| `supabase/migrations/20260925_web_push_drop_secrets_plural.sql` | Retira el RPC que devolvía los tres secretos de golpe. |
| `supabase/functions/send-web-push/index.ts` | Edge Function: autenticación, consultas, envío y mantenimiento de suscripciones. |
| `supabase/functions/send-web-push/reminders.ts` | Lógica pura de recordatorios (fechas, zonas horarias, texto). Sin I/O. |
| `supabase/functions/send-web-push/reminders.test.ts` | 28 tests con `deno test`. |
| `supabase/config.toml` | Declara `verify_jwt = false` solo para `send-web-push`. |
| `src/lib/web-push.ts` | Suscripción en el navegador, permisos, alta y baja. |
| `sw-src.js` | Service worker: precache, `push` y `notificationclick`. |
| `__tests__/lib/web-push.test.ts` | 11 tests: conversiones, normalización y sincronía de la allowlist con el service worker. |

Modificados: `src/app/(tabs)/ajustes.tsx` (interruptor con rama web + baja al cerrar sesión), `src/lib/database.types.ts`, `workbox-config.js` (de `generateSW` a `injectManifest`), `package.json` (scripts `build:sw`/`build:pwa`, devDeps `esbuild` y `workbox-*`, `testPathIgnorePatterns`), `.gitignore`, `__tests__/screens/ajustes.test.tsx`, `scripts/verify-pwa.cjs`.

## Secretos

Viven en **Supabase Vault**, no como variables de entorno de la función, para que desplegar no dependa de la Management API ni del CLI de Supabase:

| Secreto | Para qué |
|---|---|
| `vapid_public_key` | Se pide al navegador al suscribirse. Está también hardcodeada en `src/lib/web-push.ts` porque es pública por diseño. |
| `vapid_private_key` | Firma los envíos. Nunca sale de la función. |
| `push_cron_secret` | Autentica a pg_cron. Se lee de Vault en tiempo de ejecución, así que no aparece escrito en `cron.job`. |

El acceso es `public.push_service_secret(text)`, `security definer` con `search_path` vacío, revocado de `public`, `anon` y `authenticated`, y solo ejecutable por `service_role`.

## Detalles que costaron entender

- **`pg_net` corta a los 5 segundos.** El arranque en frío de la función ya consume más, así que la llamada del cron respondía con timeout. La función ahora responde `202` de inmediato y sigue trabajando con `EdgeRuntime.waitUntil`. `?sync=1` ejecuta en línea, para depurar a mano.
- **`workbox injectManifest` no empaqueta.** Copia el fuente tal cual, con sus `import` ESM, y un service worker clásico no los admite. Por eso `build:sw` empaqueta `sw-src.js` con esbuild a IIFE antes de inyectar el manifiesto de precache.
- **El comentario puede romper el build.** `self.__WB_MANIFEST` debe aparecer **exactamente una vez** en `sw-src.js`; la primera versión lo mencionaba también en el comentario de cabecera y Workbox se negaba a generar.
- **La zona horaria no es la del servidor.** `nineAmUtc` calcula el instante UTC que son las 09:00 locales con `Intl`, corrigiendo el offset dos veces para cubrir cambios de horario. La primera versión sumaba el offset sobre un ancla ya en UTC y salía una hora tarde. Los tests lo cazaron.
- **El slot "día antes" se calculaba desde el día equivocado.** `candidatesFor` construye los candidatos desde el día del evento (el aviso sale hoy si el evento es mañana), no al revés.

## Auditoría de seguridad

Dos rondas. La primera dio **BLOQUEADO** y la segunda **REVISAR** sin bloqueantes. Remediado:

| Hallazgo | Resolución |
|---|---|
| RPC y cron fuera del repo (solo en el SQL Editor) | Versionados en migraciones, con `drop` del RPC anterior. `supabase/config.toml` declara el `verify_jwt`. |
| El interruptor maestro no frenaba las citas | `isPushEnabled()` en `reminders.ts`, comprobado **antes** de generar nada, con test. Fallo cerrado si falla la consulta de preferencias. |
| Citas sin filtrar por pertenencia a la casa | `fetchCasaIds` + `.in('casa_id', casaIds)`: un exmiembro deja de recibir avisos de una casa de la que ya no es miembro. |
| Lectura de secretos antes de autenticar | `readSecret` pide de uno en uno y el del cron se lee primero; si falta configuración responde `401`, no `500`, para no dejar oráculo. |
| Un usuario podía resucitar su suscripción | Trigger `protect_push_subscription_state`: `active`, `failure_count` y `last_success_at` solo los cambia `service_role`. |
| `upsert` por `endpoint` con único global | Borrado de lo propio por `endpoint` y luego `insert`: si el endpoint es de otra cuenta falla con `23505` y se informa, en vez de devolver un "activado" falso. |
| Texto de avisos sin sanear | `sanitizeText` quita marcas bidireccionales y de ancho cero, y convierte controles en espacios. Un nombre con U+202E ya no puede falsear un aviso. |
| Allowlist del SW duplicada y sin verificar | Test de Jest que compara `ALLOWED_PUSH_ROUTES` con la lista real de `sw-src.js` y exige que el filtrado sea con `includes`, no con `startsWith`. |
| Cierre de sesión colgado sin service worker | `readyRegistration()` con techo de 3 s; si la baja falla se avisa por consola. |
| `enabled` escrito desde el selector de cumpleaños | Ese selector solo escribe `birthday_choice`. El interruptor maestro solo lo escriben `enableWebPush` y `disableWebPush`. |
| Baja de suscripción solo del navegador actual | El interruptor maestro es global del usuario: apagar en un navegador para en todos sus avisos. |
| `config.toml` con `send-email` en `verify_jwt = false` | **Introducido en este mismo bloque.** `send-email` está en producción con `verify_jwt = true` y no valida credenciales por su cuenta: declararlo así la convertía en un relay de correo abierto para cualquiera con la URL. Sección eliminada, con un comentario que explica por qué. |

Verificado empíricamente en producción, simulando los roles `anon` y `authenticated` con dos usuarios reales: rejects de insertar con `user_id` ajeno, de hacer `upsert` sobre el endpoint de otro, de actualizar y de borrar filas ajenas; `anon` no ve ni escribe nada; y el trigger de estado impide resucitar una suscripción desactivada. Las filas de prueba se borraron.

## Verificación

- `deno check` limpio; `deno test` 28/28.
- `npx tsc --noEmit` limpio; `npx expo lint` limpio; `npx jest` 43/43 suites y 514/514 tests.
- `npm run build:web` correcto; `npm run verify:pwa` 64/64, incluidas las comprobaciones nuevas de los handlers de push.
- Edge Function en producción: `401` sin secreto o con secreto incorrecto, `405` en `GET`, `202` encolando, `200` con `?sync=1`.
- `pg_cron` ejecutando cada 5 minutos con éxito y `net._http_response` registrando `202`.

**No verificado:** en un navegador real. Playwright no arranca en esta máquina (falta `libnspr4.so` y no hay sudo para instalarla), así que la suscripción, el banner de instalación y la recepción de un push siguen sin probarse de extremo a extremo.

## Riesgos aceptados y límites

- **Sin rate limit** en la Edge Function: cualquier `POST` sin credencial fuerza un descifrado de Vault y un RPC con service role. Es trabajo barato y de solo lectura, pero es pageable desde internet.
- **`net.http_request_queue` guarda la petición con el `x-cron-secret` en claro** hasta que el worker la envía. Los privilegios de `net` vienen de `PUBLIC` y Supabase los vuelve a otorgar, así que revocar no aguanta (comprobado). La mitigación real es que `net` no está en los esquemas expuestos de PostgREST. Si algún día se añade `net` a `db_schemas`, hay que revisarlo.
- **Avisos de citas solo para quien crea la cita** (`appointments.user_id`), no para todos los miembros de la casa. En nativo se programa en el dispositivo de quien abre la app, así que no había un modelo claro; este es el más coherente con `reminder_choice`, que elige quien la crea.
- **Cumpleaños: preferencia global por usuario**, igual que en nativo (AsyncStorage). No es por casa.
- **`notificationclick` enfoca la primera pestaña del mismo origen** que encuentra, no la de la casa que corresponde. Molesto, no inseguro.
- **El service worker no sanea `title`/`body` del payload.** Hoy es inocuo porque el productor es nuestro backend; si el gateway de push se comprometiera, el texto podría ir sin sanear (las rutas sí pasan por la allowlist).

## Aviso de prueba

Ajustes tiene un botón **Enviar** junto a "Aviso de prueba" que pide un push de prueba a la Edge Function (`?mode=test`). Sirve para comprobar que la suscripción está viva y que el service worker pinta la notificación, sin esperar a que llegue un recordatorio real, que solo salta en la ventana de 3 h tras las 09:00 locales.

Cómo está protegido:

- Se autentica con el **JWT de la sesión** de quien lo pulsa, no con el secreto del dispatcher. La función lo valida con `db.auth.getUser(token)` y solo busca suscripciones de ese `user_id`.
- El contenido es fijo. No hay forma de usarlo para avisar a otra cuenta ni de elegir el texto.
- Enfriamiento de 5 minutos, apoyado en la clave única de `push_log` (`test:<userId>:<bucket>`) para que funcione entre réplicas de la función. Si no queda ninguna suscripción activa se libera la reserva, para que un reintento no espere.
- `renotify: true` a diferencia de los recordatorios: dos pruebas seguidas deben sonar, que es justo lo que se quiere comprobar.
- Solo se muestra en web y cuando el navegador soporta push.

Verificado en producción: sin sesión `401`, con un token inválido `401`, y con el secreto del dispatcher en lugar de sesión `401` (no se cuela por la otra vía). El dispatcher sigue respondiendo `202`.

## Qué falta

1. Mergear `#51` (PWA) y abrir el PR de este bloque: `develop` exige revisión aprobatoria y el auto-merge está deshabilitado en el repo.
2. Decidir el destino del PR `#48` (`feat(web): oculta notificaciones en web`), que choca con esta implementación: en web las notificaciones **sí** funcionan ahora.
3. `npm run deploy:vercel` desde el worktree y comprobar `curl -s -o /dev/null -w "%{http_code}" https://micasa-demo.vercel.app` → `200`.
4. Prueba en navegador real: activar el interruptor en Ajustes y pulsar **Enviar** en "Aviso de prueba". Con eso queda verificado el envío real de extremo a extremo; para un recordatorio de verdad, añadir una cita para mañana con recordatorio "Día antes" y comprobarlo a las 09:00 locales.
5. Job `check-reminders` preexistente en `cron`, fallando cada 5 minutos desde antes de este bloque. No se ha tocado: decide si se quita.

## Contexto de rama

- Worktree: `/home/richard/MiCasa-web-push`, rama `feat/web-push`.
- La base es `5f0c373` (PWA, rebasado sobre `develop`), así que este PR incluye el commit de la PWA mientras `#51` no esté mergeado. Al mergear `#51` el diff de este PR baja solo.
- `node_modules` es un symlink al del worktree de la PWA para no reinstalar; `.gitignore` cubre los symlinks con el patrón sin barra.
