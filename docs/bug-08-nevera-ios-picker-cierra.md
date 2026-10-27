# Bug 08 — Nevera no deja elegir fecha futura en iOS

Estado: corregido en rama `fix/nevera-ios`; falta probar en iPhone real.

## Síntoma

En Nevera, al abrir «Nuevo producto», el selector de fecha solo dejaba quedarse
en el día actual. Al intentar girar el spinner hacia una fecha futura, el picker
se cerraba y la fecha no cambiaba.

## Causa raíz

`AppDatePicker` cerraba el spinner de iOS dentro de `onChange`:

```tsx
onChange={(event, selected) => {
  setShowIOSPicker(false);
  if (event.type === 'set' && selected) onChange(selected);
}}
```

El spinner de iOS dispara `onChange` en cada giro, no al confirmar. El primer
movimiento cerraba el picker antes de que la persona pudiera pasar de hoy a otro
día. En Android y web no pasaba porque usan otro camino.

## Fix

- El spinner iOS ya no se cierra en `onChange`; sigue abierto mientras se elige.
- Botón `Listo` cierra el picker de forma explícita, con `accessibilityLabel` y
  `accessibilityHint`.
- `nevera.tsx` usa `min={startOfDay(new Date())}` guardado al abrir el modal, no
  `new Date()`. Así todo el día de hoy es válido y el límite no cambia en cada
  render.
- Modal de Nevera con `ScrollView` y `maxHeight: 90%` para que el spinner abierto
  no tape el formulario en pantallas pequeñas.
- Tests nuevos:
  - `__tests__/components/ui/app-date-picker.test.tsx`: el spinner iOS sigue
    abierto tras cambiar fecha y cierra con «Listo».
  - `__tests__/screens/nevera.test.tsx`: se guarda una fecha futura y también hoy.

## Prevención

1. **No cerrar un picker en `onChange`.** En iOS, `onChange` significa «valor
   cambiado», no «usuario terminó». Cerrar ahí rompe cualquier selección que
   necesite más de un giro.
2. **Fecha sin hora usa `startOfDay`.** Un `min` con hora deja fuera parte del
   día actual y produce diferencias entre web, Android e iOS.
3. **`AppDatePicker` es compartido.** Lo usan Citas, Cumpleaños, Gastos y Nevera.
   Cualquier cambio de comportamiento exige tests de las tres plataformas:
   nativo Android, nativo iOS y web (`index.web.tsx`).
4. **Regresión obligatoria.** Un bug de fecha debe dejar un test que falle con el
   código anterior. No basta con arreglar la pantalla concreta.
5. **Editar un caducado no debe mover la fecha.** El picker puede abrir con una
   fecha anterior a `min`; guardar sin tocar debe conservar el valor. Queda como
   deuda menor si se decide permitir editar caducados.

## Verificación

- `npx tsc --noEmit` limpio.
- `npx expo lint` limpio.
- `npx jest --runInBand`: 57 suites / 940 tests.
- Security: APROBADO. QA: PASA.
- Pendiente: probar el spinner en un iPhone real y confirmar que se puede pasar
  de hoy a una fecha futura sin que se cierre.

## Archivos

- `src/components/ui/app-date-picker/index.tsx`
- `src/app/(tabs)/nevera.tsx`
- `__tests__/components/ui/app-date-picker.test.tsx`
- `__tests__/screens/nevera.test.tsx`
