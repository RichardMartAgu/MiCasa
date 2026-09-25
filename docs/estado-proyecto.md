# Estado del proyecto

## Sesión actual — 2026-09-25 (bloque citas/notificaciones)

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
