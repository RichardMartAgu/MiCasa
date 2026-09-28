# Bug 04 — Error RLS al borrar ítem de lista de la compra

## Reporte
Borrar un ítem de la lista de la compra fallaba: marca de borrado se quedaba en estado pendiente o error. Causa: la columna `casa_id` en `shopping_items` no estaba en el client (types, api, UI) y RLS no permitía DELETE seguro.

## Causa raíz
- FK `shopping_items.casa_id` sin `ON DELETE CASCADE` y policy RLS por fila incompleta (solo INSERT/SELECT; UPDATE/DELETE ambiguos por casa).
- API y UI insertaban ítems sin `casa_id`.

## Fix
- `supabase/schema.sql`: FK `casa_id` con `ON DELETE CASCADE`; policies RLS por operación (INSERT con casa en SELECT, SELECT con casa de miembro, UPDATE/DELETE por membrecía de casa).
- Migración: `supabase/migrations/20260917_fix_shopping_items_cascade.sql`.
- `src/lib/database.types.ts` + `src/lib/api.ts` + `src/app/(tabs)/listas.tsx`: se pasa `casa_id` en addItem.
- `handleAddItem` guarda con `if (!currentCasa) return;`.

## Test
`__tests__/screens/listas.test.tsx`: addItem con `casa_id`, delete OK. `__tests__/api.test.ts`: addShoppingItem envía `casa_id`. PASA.

## Nota
La combinación `if (!currentCasa) return;` evita ítems huérfanos al crear lista sin casa seleccionada.