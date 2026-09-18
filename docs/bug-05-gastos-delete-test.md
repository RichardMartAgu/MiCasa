# Bug 05 — Eliminar gasto: regresión de test

## Reporte
Eliminar gasto tras confirmar el Alert fallaba: el mock de `removeExpense` en `__tests__/screens/gastos.test.tsx` no existía, así que el test que verificaba el flujo completo no cubría la llamada.

## Causa raíz
Test con mock sin implementación real. Al confirmar en Alert no se verificaba que `removeExpense` se llamase con el id correcto. `mockRemoveExpense` no definido.

## Fix
- `__tests__/screens/gastos.test.tsx`: `mockRemoveExpense` como `jest.fn()` declarado y mockeado vía `jest.mock`.
- Test nuevo: "elimina gasto tras confirmar" → fireEvent en botón de eliminar, confirmar Alert, `expect(mockRemoveExpense).toHaveBeenCalledWith(...)`.

## Test
`__tests__/screens/gastos.test.tsx`: flujo completo delete PASA.

## Nota
Limpieza console warnings pendiente: "Encountered two children with the same key, `0`" en listado de gastos con dos categorías de mismo key en fixturas de tests (no bloquea, solo aviso).