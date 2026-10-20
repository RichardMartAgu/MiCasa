# Bloque A — correctitud

Estado: completado 2026-10-20. Security APROBADO, QA PASA.

## Objetivo

Cerrar los fallos de correctitud detectados en la revisión funcional antes de
añadir features nuevas. Nada de rediseño ni de funcionalidades nuevas.

## Alcance

### A1. Citas: guardar el instante correcto

`toISOLocal()` enviaba `YYYY-MM-DDTHH:mm` sin offset. La columna `starts_at` es
`timestamptz` y Supabase la interpreta como UTC, así que una cita de 08:20 se
mostraba a las 09:20 en Madrid. Cambio: enviar `Date.toISOString()` y dejar que
la UI formatee en la zona local.

- Archivo: `src/app/(tabs)/citas.tsx`.
- Test: la cita creada debe enviar un ISO con `Z`/offset y conservar la hora
  elegida al formatearla en local.
- No se migran filas antiguas: no hay forma fiable de saber qué hora quiso cada
  usuario. Al editar una cita antigua hay que corregir la hora a mano; guardar
  sin tocarla conserva el instante erróneo.

### A2. Feedback visible en web

`Alert.alert` es no-op en React Native Web. Sustituir los avisos de un solo
mensaje por `showNotice()` en citas, cumpleaños, gastos, listas, nevera y
Ajustes. Los `Alert.alert` con varios botones se quedan: `showNotice` no los
soporta y esos flujos solo corren en nativo.

- Archivos: pantallas de `src/app/(tabs)/`.
- Test: los errores de guardado/borrado llaman a `showNotice`; no desaparecen en
  web.

### A3. Errores de listas

Propagar el resultado de añadir, marcar y borrar artículos. Hoy se ignoran, así
que un fallo de red deja la UI como si hubiera funcionado. Mantener el texto del
input si el alta falla.

- Archivo: `src/app/(tabs)/listas.tsx`.
- Test: error de alta no limpia el input y muestra aviso; error de toggle y de
  borrado muestra aviso.

### A4. Cambio de casa sin datos viejos

`useRealtimeCollection` no limpia `data` ni reactiva `loading` al cambiar de
`casaId`. Durante la carga se puede ver la casa anterior. Cambio: resetear
`data`, `error` y `loading` al arrancar una casa o un filtro nuevos.

- Archivo: `src/hooks/use-realtime-collection.ts`.
- Test: al cambiar de casa, `data` queda vacío y `loading` vuelve a `true` antes
  de la respuesta nueva.

## Fuera de alcance

- Rediseño de Inicio, Listas o Nevera.
- Edición de listas/artículos, unidades, undo, offline, ingresos o adjuntos.
- Migración de citas ya guardadas.
- Dependabot y auditoría de dependencias.

## Criterios de aceptación

- [ ] Cita creada a las 08:20 se guarda como instante UTC correcto y se muestra
      a las 08:20 en Madrid.
- [ ] Errores de web visibles en las seis pantallas.
- [ ] Listas conserva el input si falla el alta y avisa en toggle/borrado.
- [ ] Cambio de casa no muestra datos de la anterior.
- [ ] `npx tsc --noEmit`, `npx expo lint`, `npx jest` y `npm run verify:pwa`
      en verde.
- [ ] `security` APROBADO y `qa-test` PASA antes de commit.

## Riesgos

- Cambiar el formato de `starts_at` afecta a recordatorios locales y push. Los
  helpers ya parsean ISO con `new Date()`, así que el instante correcto mejora
  ambos.
- `showNotice` usa `window.alert` en web: bloquea, pero es visible. Sustituirlo
  por un toast propio queda para un bloque de UX.
