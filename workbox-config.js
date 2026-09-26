// Configuración de Workbox para la PWA de MiCasa.
//
// Se ejecuta tras `npx expo export -p web`. El orden es: `build:sw` empaqueta
// sw-src.js con esbuild (un service worker clásico no admite imports ESM) y este
// comando, en modo `injectManifest`, genera dist/sw.js inyectando la lista de
// archivos del build. Los handlers de Web Push y el fallback de navegación viven
// en sw-src.js porque Workbox no los genera por su cuenta.
//
// Decisiones:
// - Solo se precachea lo que genera el build (shell + assets). No hay
//   runtimeCaching para APIs de Supabase ni para imágenes remotas: los datos
//   del usuario nunca se guardan en el Service Worker.
// - El Service Worker NO se activa solo. Un deploy borra el deployment anterior,
//   así que activar el SW nuevo con pestañas viejas abiertas puede pedir un chunk
//   que ya no existe. La diferencia con la versión anterior de esta decisión es
//   que "no activarlo solo" no significa "no activarlo nunca": el SW nuevo espera,
//   la app lo dice con un aviso, y quien pulsa "Recargar" manda el mensaje
//   `SKIP_WAITING` que lo activa. Ver `sw-src.js` y `src/lib/sw-update.ts`.
//   Antes el worker esperaba indefinidamente a que se cerraran todas las pestañas,
//   y con la app instalada siempre había una viva: el usuario se quedaba con el
//   bundle de su primer despliegue sin que nada lo dijera.
// - `scripts/verify-pwa.cjs` vigila que `skipWaiting` se llame exactamente una vez
//   y solo desde ese listener de `message`.//   clientes previos, el primer SW se activa igual.

module.exports = {
  swSrc: 'sw-bundle.js',
  swDest: 'dist/sw.js',
  globDirectory: 'dist',
  globPatterns: [
    'index.html',
    'manifest.webmanifest',
    'favicon.ico',
    'icon-*.png',
    'apple-touch-icon.png',
    '_expo/static/**/*.{js,css,woff,woff2,ttf,png,svg,webp}',
  ],
  globIgnores: ['**/node_modules/**', 'sw.js', 'sw.js.map', 'workbox-*.js'],
  maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
};
