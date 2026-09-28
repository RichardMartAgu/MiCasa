# Bug 06 — Casas: editar y eliminar

## Reporte
Faltaban acciones de editar nombre y eliminar casa para el owner. Solo se existía "Añadir casa".

## Causa raíz
`api.ts` sin `updateCasa`/`removeCasa`; `casa-context.tsx` sin callbacks de rename/delete; UI de ajustes sin acciones por fila de casa ni estado de edición.

## Fix

### API
- `src/lib/api.ts`: `updateCasa(id, { name })`, `removeCasa(id)`.

### Contexto
- `src/context/casa-context.tsx`: `renameCasa`/`deleteCasa` (llaman API + `refresh()`), expuestos en el value del contexto.

### UI
- `src/app/(tabs)/ajustes.tsx`:
  - Destructure `renameCasa`/`deleteCasa`; estado `editingCasa`.
  - `openEditCasa`, `openAddCasa`, `handleSaveCasa` (compartido add/edit), `handleDeleteCasa` (Alert confirm + destructivo).
  - Import `type { Casa, CasaMember }`.
  - Modal con título dinámico `Editar casa`/`Crear nueva casa` y botón `Guardar cambios`/`Crear`.
  - Solo owner ve lápiz/papera por fila; labels a11y `Editar casa ${name}`/`Eliminar casa ${name}`; style `casaRowActions`.

## Test
- `__tests__/screens/ajustes.test.tsx`: editar (`renameCasa('c1', 'Hogar renovado')`), eliminar (`deleteCasa('c1')`), no-owner sin acciones.
- `__tests__/casa-context.test.tsx`: rename/delete propagan al API.
- `__tests__/api.test.ts`: filas CRUD `updateCasa`/`removeCasa`.
PASA.

## Nota
`npx tsc --noEmit` limpio tras tipar `Casa`/`CasaMember`.