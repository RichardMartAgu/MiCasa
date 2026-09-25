
## Sesión actual — 2026-09-25 (Web Push)

- Objetivo: que la web de MiCasa reciba recordatorios de citas y cumpleaños aunque la app esté cerrada, en Android y escritorio sin necesidad de instalar.
- Worktree: `/home/richard/MiCasa-web-push`, rama `feat/web-push` sobre `5f0c373` (PWA). Detalle completo, hallazgos de security y pendientes: [`docs/web-push.md`](docs/web-push.md).
- Implementado: migraciones de `push_subscriptions`/`push_preferences`/`push_log` con RLS, RPC de secretos en Vault, `pg_cron` + `pg_net` cada 5 min, Edge Function `send-web-push` v5, service worker con handlers `push` y `notificationclick`, `src/lib/web-push.ts` y el interruptor en Ajustes.
- Decisión del usuario: recordatorios programados desde el servidor, no avisos de eventos ni push solo con la pestaña abierta. En iPhone no funciona sin instalar (lo exige iOS).
- Security: dos rondas. La primera dio BLOQUEADO y la segunda REVISAR sin bloqueantes. Remediados, entre otros, el interruptor maestro que no frenaba las citas, el filtrado de citas por pertenencia a la casa, la lectura de secretos antes de autenticar, y un `verify_jwt = false` que este mismo bloque introducía para `send-email` en `supabase/config.toml` y que la convertía en un relay de correo abierto.
- QA: PASA. `deno check` limpio, `deno test` 28/28, `npx tsc --noEmit` limpio, `npx expo lint` limpio, `npx jest` 43/43 suites y 514/514 tests, `npm run verify:pwa` 64/64.
- Verificado en producción: RLS contra dos usuarios reales (insert/upsert/update/delete ajenos rechazados, `anon` sin acceso), guarda de estado de la suscripción, 401 sin secreto, 202 encolando, cron ejecutando.
- No verificado: navegador real. Playwright no arranca en esta máquina (falta `libnspr4.so`, sin sudo).
- Pendiente: merge de `#51`, PR de este bloque, deploy a Vercel, prueba en navegador y decidir qué hacer con el PR `#48`, que choca con esta implementación.
- Commit/push: pendiente.

## Sesión anterior — 2026-09-25 (PWA instalable)

- Objetivo: que la web de MiCasa sea instalable como PWA desde el navegador. Opción elegida por el usuario: PWA (descartadas links a tiendas y APK directo).
- Worktree: `/home/richard/MiCasa-pwa-installable`, rama `feat/pwa-installable` desde `3d3492d`.
- Detalle completo, decisiones, hallazgos de security y pendientes: [`docs/pwa-installable.md`](pwa-installable.md).
- Implementado: `public/manifest.webmanifest`, cuatro iconos PWA, `public/index.html` como plantilla del export web (metas PWA + registro del SW protegido por HEAD/Content-Type), `workbox-config.js`, `scripts/verify-pwa.cjs`, scripts `build:pwa` y `verify:pwa`, `build:web` encadenado, `serve-demo.sh` y `vercel.json` (buildCommand + headers de seguridad y de no-cache para `sw.js`).
- Gotcha discovered: con `web.output: "single"` el HTML sale de `public/index.html`, no de `+html.tsx`; ver doc.
- Security: APROBADO. Remediados F1 (sin `skipWaiting`/`clientsClaim` para evitar version-skew con deploys que borran el anterior), F2 (rewrite revertido al original) y F3 (headers `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`). F4 (CSP) queda fuera, en iteración aparte.
- QA: PASA. `npx tsc --noEmit` limpio, `npx expo lint` limpio, `npx jest` 42/42 suites y 497/497 tests, `npm run verify:pwa` 57/57.
- Límite conocido: "instalable" no es "offline con datos". El SW sirve shell y assets; los datos van siempre a Supabase.
- No verificado: prueba en navegador real (Playwright no arranca en esta máquina: falta `libnspr4.so` y no hay sudo) y prueba en dispositivo.
- Pendiente: commit, push, PR a `develop`, deploy con `npm run deploy:vercel` y verificación en dispositivo.
- Commit/push: pendiente.

## Sesión anterior — 2026-09-25 (bloque citas/notificaciones)

- PR #52 `fix(citas): desbloquea el guardado cuando el aviso de notificaciones no resuelve` mergeado a `develop` en `ff4bbcae1a65163bad96348c606d9ef4965b2086`.
- Commit de implementación: `f3e8d34`.
- Bug: no se podían guardar citas. El registro sí llegaba a Supabase, pero el modal nunca cerraba.
- Causa: `handleSave` hacía `await askEnableNotifications()` antes de `setModalVisible(false)`. El Promise solo resolvía en `onPress` (sin `onDismiss` ni `cancelable`) y el `Alert.alert` se lanzaba con el `Modal` abierto, que en Android lo muestra en una ventana detrás, invisible. Agravante: la cola `enqueue` envenenaba de forma permanente si una tarea se colgaba.
- Archivos: `src/app/(tabs)/citas.tsx`, `src/lib/notifications.ts`, `__tests__/screens/citas.test.tsx`, `__tests__/lib/notifications.test.ts`.
- QA: PASA. `npx tsc --noEmit` OK, `npx expo lint` OK, 42/42 suites, 501/501 tests. Cobertura `notifications.ts` 97.38% líneas, `citas.tsx` 90.96%.
- CI: verde (1m13s).
- Sin migraciones ni cambios de schema. Schema, constraints y RLS de `appointments` verificados correctos en producción.
- Security: revisado en el bloque. Sin cambios de auth, RLS, secrets ni superficie de red. El cambio es de orden de operaciones en cliente y de robustez de un Alert local.
- Worktree: eliminado. Rama local borrada.
- Pendiente: verificación manual en build nativo Android (no hay build nativo en este entorno) y deploy a Vercel si se decide publicar.

## Sesión anterior — 2026-09-25

- Estado funcional: completo. PR #49 `feat(citas): permitir iconos editables en tipos` mergeado a `develop` en `015bd53f000312fc22c0c63a859c3b7cd5afba1d`.
- Commit de implementación: `481b81c`.
- Security: APROBADO.
- QA: PASA. Typecheck OK, lint OK, 42/42 suites, 497/497 tests, 145/145 dirigidos, cobertura 100%, diff check OK.
- CI: verde.
- Migración Supabase producción: proyecto `sxgsqvwvugdklycpqxiu`; constraint `appointment_kinds_icon_check` válido; 0 iconos inválidos; migración remota `20260925133317_appointment_kinds_icon_check` aplicada desde `supabase/migrations/20260922_appointment_kinds_icon_check.sql`.
- Deploy Vercel producción: READY; deployment `dpl_EvSbKmYouscFa67eBWwHCvnSnSJf`; alias `https://micasa-demo.vercel.app`; HTTP 200.

## Reglas de cierre

1. Mantener typecheck, lint, suites, tests dirigidos, cobertura y diff check en verde antes de commit.
2. Ejecutar `npx tsc --noEmit`, `npx expo lint` y `npx jest`.
3. Reauditar security y confirmar APROBADO.
4. Commit y push solo con security APROBADO y QA PASA.
5. Tras merge aprobado, limpiar worktree con `git worktree remove /home/richard/MiCasa-feat-appointment-kind-manager`.

## Warning

`/home/richard/MiCasa` contiene una modificación ajena en `app.json`, en rama `develop`. No tocar ni incluir ese archivo en esta feature.

## Plantilla para cerrar bloque

```md
## Bloque <nombre> — <fecha>
- Objetivo: <qué cambia>
- Archivos: <rutas>
- Security: <APROBADO/REVISAR/BLOQUEADO>
- QA: <PASA/REVISAR/FALLA> — <checks y resultado>
- Commit/push: <pendiente/SHA/URL>
- Siguiente: <acción>
```
