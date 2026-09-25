# INDEX — MiCasa

App móvil Expo + web Astro para gestionar el hogar. Inventario documental: 15 `.md` versionados. Este índice se actualiza al crear, modificar o borrar cualquier `.md`.

> Warning: `/home/richard/MiCasa` contiene una modificación ajena en `app.json`, en rama `develop`. No tocarla.

## Inventario completo

### Reglas y entrada

| Archivo | Propósito | Estado |
|---|---|---|
| [`AGENTS.md`](AGENTS.md) | Reglas del proyecto, Expo v57, stack, agentes, calidad, deploy y worktrees. | Vigente; leer primero. |
| [`CLAUDE.md`](CLAUDE.md) | Redirección a reglas de `AGENTS.md`. | Vigente; 1 línea. |
| [`INDEX.md`](INDEX.md) | Índice compacto y punto de entrada con menos tokens. | Actualizado 2026-09-25. |
| [`README.md`](README.md) | Descripción del producto, funcionalidades, stack, puesta en marcha, calidad, estructura y modelo de datos. | Vigente. |
| [`docs/estado-proyecto.md`](docs/estado-proyecto.md) | Bitácora global accionable para continuar sesiones. | Versionado; actualizado 2026-09-25. |

### Bugs resueltos o documentados

| Archivo | Propósito | Estado |
|---|---|---|
| [`docs/bug-01-listas-boton-portrait.md`](docs/bug-01-listas-boton-portrait.md) | Botón de añadir visible en listas en portrait. | Corregido; test pasa. |
| [`docs/bug-02-tipos-cita-editables.md`](docs/bug-02-tipos-cita-editables.md) | Tipos de cita editables, borrables y persistidos por casa. | Corregido; test pasa. Decisión security member-wide. |
| [`docs/bug-03-calendario-android.md`](docs/bug-03-calendario-android.md) | Sincronización de cumpleaños y manejo de permisos Android. | Corregido; falta revisión en dispositivo real. |
| [`docs/bug-04-lista-compra-cascade.md`](docs/bug-04-lista-compra-cascade.md) | RLS y cascade al borrar ítems de listas. | Corregido; test pasa. |
| [`docs/bug-05-gastos-delete-test.md`](docs/bug-05-gastos-delete-test.md) | Regresión de test al confirmar eliminación de gasto. | Corregido; test pasa. Queda warning no bloqueante de keys. |
| [`docs/bug-06-casas-editar-eliminar.md`](docs/bug-06-casas-editar-eliminar.md) | Edición y eliminación de casas por owner. | Corregido; tests pasan. |
| [`docs/bug-07-shopping-realtime-delete.md`](docs/bug-07-shopping-realtime-delete.md) | Refresco realtime al borrar ítems/listas. | Corregido y aplicado en producción; verificación manual registrada. |

### Planes y pendientes

| Archivo | Propósito | Estado |
|---|---|---|
| [`docs/calendar-sync-plan.md`](docs/calendar-sync-plan.md) | Plan de sincronización anual de cumpleaños con calendario nativo. | Implementado parcialmente; requiere build nativo y revisión manual. |
| [`docs/list-filtering-plan.md`](docs/list-filtering-plan.md) | Búsqueda y filtros reutilizables en Gastos, Citas y Cumpleaños. | Completado; security APROBADO y QA PASA en bloques registrados. |
| [`docs/oauth-google-pendiente.md`](docs/oauth-google-pendiente.md) | Estado y pasos de configuración de OAuth Google. | Código listo; faltan credenciales, configuración dashboard y PR. |

## Orden de acceso

1. `AGENTS.md`
2. Este `INDEX.md`
3. `README.md` bajo demanda
4. `docs/estado-proyecto.md` para estado de sesión
5. Agentes: consultar tabla de `AGENTS.md`; invocar solo el aplicable.
6. Código: `grep`/`glob` antes de leer; `src/lib/` contiene lógica pura testeable.

## Proyecto

- Móvil: `src/`, Expo Router, paleta Dusk.
- Web: `web/`, Astro y componentes compartidos.
- Datos: Supabase, PostgreSQL, RLS y Realtime.
- Calidad: `npx tsc --noEmit`, `npx expo lint`, `npx jest`.
- Deploy Vercel: manual con `npm run deploy:vercel`; nunca asumir auto-deploy tras push.
