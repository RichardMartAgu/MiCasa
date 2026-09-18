# Bug 03 — Sincronización de cumpleaños no funciona en Android

## Reporte
En Android, sincronizar cumpleaños con el calendario no hacía nada o fallaba silenciosamente.

## Causa raíz
Faltaban permisos de calendario en `app.json` (`READ_CALENDAR`/`WRITE_CALENDAR`). Además `syncBirthdays` en `calendar-sync.ts` propagaba errores sin captura, y la UI no manejaba fallos del sistema de calendario.

## Fix
- `app.json`: permisos Android `READ_CALENDAR`, `WRITE_CALENDAR`.
- `src/lib/calendar-sync.ts`: `syncBirthdays` envuelto en try/catch → devuelve `{ synced: 0, errors: 0 }` sin propagar excepción a la UI.
- `src/app/(tabs)/cumpleanos.tsx`: `handleSync` con try/catch y `Alert.alert('Error', 'No se pudo acceder al calendario. Revisa los permisos.')`.

## Test
`__tests__/lib/calendar-sync.test.ts`: sync falla sin lanzar; UI muestra Alert. PASA.

## Pendiente
Revisar en dispositivo Android real: concesión de permisos y creación real de eventos.