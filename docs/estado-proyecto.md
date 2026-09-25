# Estado del proyecto

## Sesión actual — 2026-09-25

- Rama: `feat/appointment-kind-manager`
- Worktree: `/home/richard/MiCasa-feat-appointment-kind-manager`
- Objetivo: gestor de tipos de cita con iconos editables.
- Archivos modificados (7): `INDEX.md`, `__tests__/api.test.ts`, `__tests__/lib/notifications.test.ts`, `__tests__/screens/citas.test.tsx`, `src/app/(tabs)/citas.tsx`, `src/lib/api.ts`, `supabase/schema.sql`.
- Archivos nuevos (6): `__tests__/components/ui/icon-picker.test.tsx`, `__tests__/lib/appointment-icons.test.ts`, `docs/estado-proyecto.md`, `src/components/ui/icon-picker.tsx`, `src/lib/appointment-icons.ts`, `supabase/migrations/20260922_appointment_kinds_icon_check.sql`.
- Security: APROBADO.
- QA: PASA. Typecheck OK, lint OK, 42/42 suites, 497/497 tests, 145/145 dirigidos, cobertura 100%, diff check OK.
- Commit: pendiente.
- Push: pendiente.

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
