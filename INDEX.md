# INDEX — MiCasa

App Expo (móvil + web/PWA) para gestionar el hogar. Inventario documental: 19 `.md` versionados. Este índice se actualiza al crear, modificar o borrar cualquier `.md` o skill. **Para no leer un `.md` entero, mirar antes el mapa de secciones de abajo.**

## Inventario completo

### Reglas y entrada

| Archivo | Propósito | Estado |
|---|---|---|
| [`.opencode/skills/micasa-git/SKILL.md`](.opencode/skills/micasa-git/SKILL.md) | Buenas prácticas de git de este repo: worktree por rama, comandos que ya han perdido trabajo, dependabot→`master`. | Vigente; leer antes de commitear/pushear/mergear. |
| [`AGENTS.md`](AGENTS.md) | Reglas del proyecto, Expo v57, stack, agentes, calidad, deploy y worktrees. | Vigente; leer primero. |
| [`CLAUDE.md`](CLAUDE.md) | Redirección a `AGENTS.md`. | Vigente; 1 línea. |
| [`INDEX.md`](INDEX.md) | Índice compacto y punto de entrada con menos tokens. | Actualizado 2026-09-29. |
| [`README.md`](README.md) | Producto, funcionalidades, stack, puesta en marcha, calidad, estructura, modelo de datos. | Vigente. |
| [`docs/estado-proyecto.md`](docs/estado-proyecto.md) | Bitácora global para continuar sesiones. **Empezar por «Pendientes»; las sesiones están en orden inverso (la primera «Sesión actual» es la más reciente).** | Actualizado 2026-09-28. |

### Bugs resueltos o documentados

| Archivo | Propósito | Estado |
|---|---|---|
| [`docs/bug-01-listas-boton-portrait.md`](docs/bug-01-listas-boton-portrait.md) | Botón de añadir oculto en listas en portrait. | Corregido; test pasa. |
| [`docs/bug-02-tipos-cita-editables.md`](docs/bug-02-tipos-cita-editables.md) | Tipos de cita editables, borrables y persistidos por casa. | Corregido; test pasa. |
| [`docs/bug-03-calendario-android.md`](docs/bug-03-calendario-android.md) | Sincronización de cumpleaños y permisos Android. | Corregido; falta revisión en dispositivo real. |
| [`docs/bug-04-lista-compra-cascade.md`](docs/bug-04-lista-compra-cascade.md) | RLS y cascade al borrar ítems de listas. | Corregido; test pasa. |
| [`docs/bug-05-gastos-delete-test.md`](docs/bug-05-gastos-delete-test.md) | Regresión de test al confirmar eliminación de gasto. | Corregido; test pasa. |
| [`docs/bug-06-casas-editar-eliminar.md`](docs/bug-06-casas-editar-eliminar.md) | Edición y eliminación de casas por owner. | Corregido; tests pasan. |
| [`docs/bug-07-shopping-realtime-delete.md`](docs/bug-07-shopping-realtime-delete.md) | Refresco realtime al borrar ítems/listas. | Corregido y en producción. |

### Planes y pendientes

| Archivo | Propósito | Estado |
|---|---|---|
| [`docs/calendar-sync-plan.md`](docs/calendar-sync-plan.md) | Plan de sincronización anual de cumpleaños con calendario nativo. | Parcial; requiere build nativo. |
| [`docs/list-filtering-plan.md`](docs/list-filtering-plan.md) | Búsqueda y filtros reutilizables en Gastos, Citas y Cumpleaños. | Completado; APROBADO/PASA. |
| [`docs/oauth-google-pendiente.md`](docs/oauth-google-pendiente.md) | Estado y pasos de OAuth Google. | Código listo; faltan credenciales y dashboard. |
| [`docs/pwa-installable.md`](docs/pwa-installable.md) | PWA instalable: manifest, service worker, iconos, decisiones de security. | Desplegado; quedan items en su «Qué falta». |
| [`docs/usuarios-prueba.md`](docs/usuarios-prueba.md) | Cuentas de prueba en producción y sus límites de seguridad. | Vigente; credenciales en `.env.local`. |
| [`docs/web-push.md`](docs/web-push.md) | Web Push (recordatorios en web): Edge Function, SW, cron, CORS, VAPID. | Mergeado (#54) y desplegado; CORS de previews mergeado (#83), v11 en prod. Falta prueba en navegador. |

## Mapa de secciones (grep aquí antes de abrir el fichero)

| Dónde | Secciones (`##`) |
|---|---|
| `docs/estado-proyecto.md` | Pendientes · Riesgos aceptados · Sesiones (inverso) · Reglas de cierre · Plantilla de bloque · Warning |
| `docs/web-push.md` | Qué resuelve · Alcance · Arquitectura · Ficheros · Secretos · Detalles que costaron entender · Auditoría · Verificación · Riesgos · **CORS** · **«Si el botón Enviar falla otra vez»** · Aviso de prueba · Qué falta · Contexto de rama · **Rotar VAPID** |
| `docs/pwa-installable.md` | Objetivo · Gotcha `web.output: single` · Archivos · Registro del SW · Decisiones security · Verificación · Alcance · Qué falta |
| `docs/usuarios-prueba.md` | Por qué existen · `qa-toggle@micasa.dev` · Recrear cuenta · Reglas de seguridad |
| `docs/calendar-sync-plan.md` | Objetivo · Opción seleccionada · Cambios necesarios · Edge cases · Build · Orden · Coste · Riesgos · Preguntas |
| `docs/list-filtering-plan.md` | Objetivo · Alcance · Componentes · Filtrado por pantalla · Orden de implementación · Fuera de alcance |
| `docs/oauth-google-pendiente.md` | Pasos de configuración · Archivos tocados |
| `docs/bug-0X-*.md` | Reporte/Síntoma · Causa raíz · Fix · Test · Nota (nunca leer: bug ya cerrado) |
| `AGENTS.md` | Expo v57 · Idioma · Acceso a info · Emails · Frontend · Agentes · Flujo por bloque · Git · Reglas duras (worktree, nada abierto) · **Despliegue** · Telegram |
| `README.md` | Funcionalidades · Stack · Puesta en marcha · Demo · Calidad · Estructura · Modelo de datos |

## Orden de acceso

1. `AGENTS.md`
2. Este `INDEX.md` (mapa de secciones incluido)
3. `README.md` bajo demanda
4. `docs/estado-proyecto.md` → «Pendientes» + sesión más reciente
5. Agentes: tabla de `AGENTS.md`; invocar solo el aplicable.
6. Código: `grep`/`glob` antes de leer; `src/lib/` = lógica pura testeable.

## Proyecto

- Móvil y web: `src/`, Expo Router, paleta Dusk. La web es el mismo código (`expo export --platform web`) con Workbox encima.
- No existe `web/`: es la PWA construida desde `src/`.
- Datos: Supabase, PostgreSQL, RLS y Realtime.
- Calidad: `npx tsc --noEmit`, `npx expo lint`, `npx jest`, `npm run verify:pwa`.
- Deploy Vercel: manual con `npm run deploy:vercel` (ver puntero de `AGENTS.md` → nota privada de tokens).
