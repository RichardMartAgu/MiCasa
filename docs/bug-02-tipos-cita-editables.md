# Bug 02 — Tipos de cita editables y borrables

## Reporte
Los tipos de cita (medico, escuela, mascota, personal, otro) estaban hardcodeados en `src/app/(tabs)/citas.tsx`. No se podían añadir, editar ni eliminar. Además el tipo se guardaba como string libre pero el schema de Postgres restringía valores.

## Causa raíz
- Sin tabla `appointment_kinds` en Supabase: sin fuente editable.
- Check constraint `appointments_kind_check` limitaba `kind` a 5 valores fijos.
- UI sin gestor de tipos.

## Fix

### Schema
- `supabase/schema.sql`: `appointments.kind` check reemplazada por longitud `char_length(kind) between 1 and 40`. Nueva tabla `appointment_kinds` (casa_id, name, icon, sort_order, unique(casa_id, name)). `handle_new_casa()` siembra 5 tipos por defecto (medico/escuela/mascota/personal/otro). RLS `appointment_kinds_all_member`. Tabla en publicación `supabase_realtime`.
- Migración: `supabase/migrations/20260917_appointment_kinds.sql`.

### Tipos
- `src/lib/database.types.ts`: filas `appointment_kinds`.
- `src/lib/types.ts`: `AppointmentKindRow`; `Appointment.kind` ampliado a `string`.

### API
- `src/lib/api.ts`: `fetchAppointmentKinds`, `addAppointmentKind`, `updateAppointmentKind`, `removeAppointmentKind`. `addAppointment`/`updateAppointment` aceptan `kind: string`.

### UI
- `src/app/(tabs)/citas.tsx`: tipos desde `useRealtimeCollection('appointment_kinds')`, fallback `DEFAULT_KINDS`. Enlace "Gestionar tipos" abre modal de gestión (añadir/editar/eliminar, nombre ≤ 40). Nuevo tipo usable al crear cita.

## Test
`__tests__/screens/citas.test.tsx`: 13 tests PASA, incluidos añadir/editar/eliminar tipo y crear cita con tipo custom. `__tests__/api.test.ts`: CRUD de kinds. Queries en segundo modal anidado requieren `includeHiddenElements: true`.

## Decisión de diseño (auditoría security)
RLS de `appointment_kinds` queda **member-wide** (`is_casa_member`): cualquier miembro puede crear/editar/borrar tipos. Aprobado por usuario 2026-09-17. Mitigación defensa en profundidad: CHECK DB `char_length(name) between 1 and 40`.