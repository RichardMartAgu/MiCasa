# Bug 01 — Botón añadir oculto en listas (orientación portrait)

## Reporte
En `src/app/(tabs)/listas.tsx`, en orientación portrait, el botón de añadir elemento quedaba fuera de pantalla o comprimido. El campo input con flex y el botón sin límite de ancho hacían que el contenedor no cupiese.

## Causa raíz
`itemInput` y `qtyInput` usaban `flex` sin `minWidth: 0` ni `flexShrink`, y el botón de añadir no tenía resistencia a compresión. En anchos pequeños el input empujaba el botón fuera.

## Fix
`src/app/(tabs)/listas.tsx`:
- Inputs con `flexShrink: 1, minWidth: 0`.
- Botón añadir sin `flex: 1` (usa su ancho natural).

## Test
`__tests__/screens/listas.test.tsx`: test de render de input y botón de añadir en el formulario. PASA.

## Nota
Test regresión actualizado con `casa_id` en fixture de item; `handleAddItem` guarda con `if (!currentCasa) return;`.