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
// - El Service Worker no lleva `skipWaiting`: los deploys borran el deployment
//   anterior, así que activar el SW nuevo con pestañas viejas abiertas puede
//   pedir un chunk que ya no existe ni en red ni en caché. El SW nuevo espera a
//   que se cierren todas las pestañas. La instalación sigue funcionando: sin
//   clientes previos, el primer SW se activa igual.

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
