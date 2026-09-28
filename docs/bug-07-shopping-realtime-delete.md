# Bug 07 — Borrar ítem/lista de la compra no refresca la UI (realtime)

## Síntoma

En la sección Listas, al borrar un ítem con la X (o al añadir un ítem nuevo después de borrar otro):

- La X no borra el ítem visible: el ítem se elimina en la base de datos pero sigue en pantalla.
- Al añadir un ítem nuevo, parece que "sobrescribe" al anterior: el ítem fantasma (ya borrado en DB) desaparece de golpe al refetchear.

## Causa raíz

`replica identity DEFAULT` en `shopping_items` y `shopping_lists`.

Supabase Realtime (`postgres_changes`) filtra eventos por la condición del canal (`list_id=eq.X`, `casa_id=eq.X`). Con `replica identity DEFAULT`, los eventos `DELETE` solo transportan la PK de la fila borrada, por lo que el filtro sobre columnas no-PK no se puede evaluar y el evento se descarta. El cliente (`useRealtimeCollection`) depende exclusivamente del evento para refetchear → la UI nunca se entera del borrado.

Verificado con test real contra el proyecto: con `DEFAULT`, DELETE se aplica en DB pero el evento llega 0 veces. Con `FULL`, el evento llega y la UI refetchea.

Los eventos `INSERT` sí llegan (la fila nueva trae todas las columnas) → añadir ítem refresca, lo que encadena la apariencia de "sobrescribe el anterior" cuando había ítems fantasma.

## Fix

Migración `supabase/migrations/20260918_fix_realtime_replica_identity.sql`:

```sql
alter table public.expenses replica identity full;
alter table public.appointments replica identity full;
alter table public.appointment_kinds replica identity full;
alter table public.shopping_lists replica identity full;
alter table public.shopping_items replica identity full;
alter table public.categories replica identity full;
alter table public.contacts replica identity full;
alter table public.casa_members replica identity full;
```

Aplicada en producción. `schema.sql` actualizado (sección Realtime).

Alcance: todas las tablas de la publicación `supabase_realtime`. El mismo defecto latente afectaba a gastos, citas, contactos, categorías y miembros del hogar (DELETE sin refresh); se corrige la clase entera de una vez.

## Coste

WAL mayor por fila en UPDATE/DELETE de estas tablas. Irrelevante: tablas pequeñas, bajo volumen, filas cortas.

## Verificación

- Sin cambios de código cliente: el refresh depende del evento realtime que ahora llega.
- Test experimental contra prod: con `DEFAULT` el evento DELETE llegaba 0 veces; con `FULL` llega y el filtro `list_id=eq.X` se evalúa correctamente.
- QA manual: borrar ítem con X → desaparece al instante; borrar lista → desaparece; añadir varios ítems → todos anidan bajo su lista; borrar gasto/cita/contacto → desaparece sin recargar.