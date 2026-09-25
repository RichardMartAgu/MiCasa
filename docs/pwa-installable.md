# PWA instalable — MiCasa

Estado: **implementado y verificado en build. Pendiente: commit, PR, deploy y prueba en dispositivo real.**

## Objetivo

Permitir instalar la web de MiCasa como app instalable (PWA) desde el navegador, sin pasar por App Store ni Google Play. El usuario eligió esta vía entre tres opciones (PWA / links a tiendas / APK directo).

Base: `dist/` exportado con `expo export --platform web`, `web.output: "single"` (SPA), desplegado como estático en Vercel.

## Documentación consultada

- `https://docs.expo.dev/guides/progressive-web-apps/` — receta oficial: manifest en `public/`, plantilla HTML según `web.output`, Workbox CLI para el service worker.
- `https://docs.expo.dev/router/migrate/from-expo-webpack/` — Expo Router no genera manifest automáticamente.
- `https://docs.expo.dev/router/reference/reserved-paths` — `/manifest` está reservado; el fichero se llama `manifest.webmanifest`.

## Gotcha discovered: con `web.output: "single"` no se usa `+html.tsx`

Primera implementación falló porque el `index.html` exportado seguía siendo el de por defecto. Causa real, confirmada leyendo el código de Expo SDK 57 (`@expo/cli/build/src/start/server/webTemplate.js` y `export/exportApp.js`):

- Con `output: "server"` o `"static"`, el HTML sale de `+html.tsx`.
- Con `output: "single"` (este proyecto), el HTML sale de `createTemplateHtmlFromExpoConfigAsync()`, que lee la plantilla `public/index.html` y sustituye `%LANG_ISO_CODE%` y `%WEB_TITLE%` por `String.replace`. Un `+html.tsx` en `src/app/` se ignora por completo.

`lang` se fija a `es` en la plantilla porque `web.lang` vive en `app.json`, que no se toca (modificación ajena en `develop`).

## Archivos

| Archivo | Qué hace |
|---|---|
| `public/manifest.webmanifest` | Manifest PWA. `id`/`start_url`/`scope` = `/`, `display: standalone`, `orientation: portrait`, `theme_color` y `background_color` `#0B1220` (paleta Dusk de `src/constants/theme.ts`). Iconos `any` 192/512 + `maskable` 512. Shortcuts a `/citas` y `/gastos` (rutas verificadas en `src/app/(tabs)/`). Extensión `.webmanifest` para que el Content-Type sea `application/manifest+json`. |
| `public/icon-192.png` | Redimensionado de `assets/images/icon.png` (1024²). |
| `public/icon-512.png` | Ídem 512. |
| `public/icon-maskable-512.png` | Logo al 80% sobre fondo sólido `#0B1220`, para que el recorte del sistema no toque contenido. |
| `public/apple-touch-icon.png` | 180×180; iOS no usa el manifest para el home screen. |
| `public/index.html` | Plantilla HTML del export web: `lang="es"`, `viewport-fit=cover`, `<link rel="manifest">`, `apple-touch-icon`, `theme-color`, `color-scheme: dark`, metas `apple-mobile-web-app-*`, estilo `expo-reset` (imprescindible para el layout de RN Web) y registro del service worker. |
| `workbox-config.js` | Workbox: precachea solo `index.html`, `manifest.webmanifest`, `favicon.ico`, `icon-*.png`, `apple-touch-icon.png` y `_expo/static/**`. Sin `runtimeCaching`: los datos del usuario nunca se guardan en el Service Worker. `navigateFallback: /index.html`, denylist `/_expo/`, `/__expo`, `/api/`. `cleanupOutdatedCaches`. `maximumFileSizeToCacheInBytes: 5 MiB`. |
| `scripts/verify-pwa.cjs` | Verificación estática del build: manifest, sizes reales de los PNG, HTML sin placeholders, y contenido del `sw.js` (precache, revisiones, fallback, ausencia de estrategias de runtime). Ejecutar con `npm run verify:pwa`. |

Archivos modificados:

| Archivo | Cambio |
|---|---|
| `package.json` | `build:web` → `expo export --platform web && npm run build:pwa`; nuevos scripts `build:pwa` (`workbox generateSW workbox-config.js`) y `verify:pwa`; `workbox-cli@^7.3.0` en devDependencies. |
| `scripts/serve-demo.sh` | La reconstrucción usa `npm run build:web`, para que el SW se genere también en local. |
| `vercel.json` | `buildCommand` → `npm run build:web` (en Vercel también hace falta generar el SW). Headers: `Cache-Control: no-cache, no-store, must-revalidate` en `/sw.js`; `Content-Type: application/manifest+json` en el manifest; y `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` globales. Rewrite SPA sin cambios. |

`app.json` **no** se toca (modificación ajena en `develop`; el manifest va en `public/`, no requiere config).

Iconos generados con `sharp` instalado fuera del repo: `/tmp/opencode/pwa/gen-icons.cjs` (no hay ImageMagick ni `sharp` en el proyecto).

## Registro del service worker

En `public/index.html`, antes de registrar se hace `fetch('/sw.js', { method: 'HEAD' })` y solo se registra si la respuesta es 200 y su `Content-Type` es JavaScript. Motivo: en el dev server y en despliegues viejos `/sw.js` devuelve el `index.html` del rewrite SPA, y sin esa guarda se instalaría un service worker corrupto.

## Decisiones y hallazgos de la auditoría de security

Veredicto: **APROBADO**. Remediaciones aplicadas:

- **F1 (medio) — activation forzada.** Se quitaron `skipWaiting` y `clientsClaim`. Con los deploys que borren el deployment anterior, activar el SW nuevo mientras una pestaña antigua sigue abierta puede pedir un chunk que ya no existe ni en red ni en caché (`Failed to fetch dynamically imported module`). El SW nuevo espera a que se cierren todas las pestañas. La instalación sigue funcionando: sin clientes previos, el primer SW se activa igual. `scripts/verify-pwa.cjs` vigila que no se reintroduzca la activación forzada.
- **F2 (medio) — regex del rewrite.** Se revirtió el negative lookahead y se dejó el rewrite original `/(.*) → /index.html`: los `rewrites` de Vercel se aplican después de servir los estáticos, así que `/sw.js` y el manifest se sirven del disco sin necesidad de excluirlos.
- **F3 (bajo) — hardening.** Añadidos `X-Content-Type-Options`, `X-Frame-Options: DENY` (la app muestra datos privados: gastos, citas), `Referrer-Policy` y `Permissions-Policy`.
- **F4 (bajo) — CSP.** Fuera de este bloque: rompería por el `<script>` y el `<style>` inline, por `eval` en el bundle de Expo y por needing `connect-src` hacia Supabase/Realtime. Iteración aparte.
- Sin datos de usuario en el precache. `NavigationRoute` de Workbox solo intercepta navegaciones del navegador; las llamadas a `*.supabase.co` son cross-origin y quedan fuera del scope del SW. Sin `runtimeCaching`, ninguna respuesta de API se persiste.

## Verificación realizada

- `npm run build:web` en el worktree: export correcto, `dist/sw.js` + `dist/workbox-*.js` generados, precache de 8 URLs (3.59 MB).
- `npm run verify:pwa`: **57/57 comprobaciones OK**.
- Servido con `npx serve -s dist`: `/`, `/manifest.webmanifest`, `/sw.js`, iconos y ruta profunda `/gastos` devuelven 200; el manifest se sirve como `application/manifest+json`.
- `npx tsc --noEmit`: limpio. `npx expo lint`: limpio. `npx jest`: 42/42 suites, 497/497 tests.
- **No verificado en navegador real.** Playwright no puede arrancar en esta máquina: falta `libnspr4.so` y no hay sudo para instalarla (`npx playwright install-deps` bloqueado). Queda pendiente comprobar en el navegador: registro del SW, banner de instalación, arranque sin red y Lighthouse PWA.

## Alcance funcional

"Instalable" no es "offline con datos". El SW sirve el shell y los assets del build; sin red la PWA arranca pero no puede autenticar ni consultar Supabase. Es intencionado: cachear datos autenticados en el SW abriría riesgos cross-user.

## Qué falta

1. Decidir si se quiere soporte offline real (no recomendado con datos de Supabase) o dejarlo documentado como limitación.
2. `git add` de lo pendiente, commit y push de `feat/pwa-installable`.
3. PR contra `develop` y merge con aprobación del usuario.
4. `npm run deploy:vercel` desde el worktree y comprobar `curl -s -o /dev/null -w "%{http_code}" https://micasa-demo.vercel.app` → `200`.
5. Verificar cabeceras en producción: `curl -I https://micasa-demo.vercel.app/sw.js` y `.../manifest.webmanifest`.
6. Probar en dispositivo Android (Chrome → menú → "Instalar app") y en iOS Safari (Compartir → "Añadir a pantalla de inicio").
7. Lighthouse PWA sobre producción.
8. Limpiar el worktree tras el merge: `git worktree remove /home/richard/MiCasa-pwa-installable`.

## Contexto de rama

- Worktree: `/home/richard/MiCasa-pwa-installable`
- Rama: `feat/pwa-installable`, base `3d3492d` (`develop`)
- Directorio principal `/home/richard/MiCasa` sigue en `develop` con `app.json` modificado por terceros: no tocar.
- Otro worktree existente (no relacionado): `/home/richard/MiCasa-feat-web-notif-hide`.
- `node_modules` del worktree instalado con `npm ci` (el primer `npm install` dejó `.d.ts` de `expo-calendar` y `expo-notifications` ausentes y `tsc` fallaba; `npm ci` lo resolvió).
