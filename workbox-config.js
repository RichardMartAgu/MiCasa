// Configuración de Workbox para la PWA de MiCasa.
// Se ejecuta tras `npx expo export -p web` y genera dist/sw.js.
//
// Decisiones:
// - Solo se precachea lo que genera el build (shell + assets). No hay
//   runtimeCaching para APIs de Supabase ni para imágenes remotas: los datos
//   del usuario nunca se guardan en el Service Worker.
// - Navegación con fallback al shell para que el SPA funcione offline.
// - Sin `skipWaiting` ni `clientsClaim` a propósito: los deploys en Vercel
//   eliminan el deployment anterior, así que activar el SW nuevo por la fuerza
//   mientras una pestaña antigua sigue abierta puede pedir un chunk que ya no
//   existe ni en red ni en caché. El SW nuevo espera a que se cierren todas
//   las pestañas y entonces toma el control. La instalación en el navegador
//   sigue funcionando: sin clientes previos, el primer SW se activa igual.

module.exports = {
  globDirectory: 'dist',
  globPatterns: ['index.html', 'manifest.webmanifest', 'favicon.ico', 'icon-*.png', 'apple-touch-icon.png', '_expo/static/**/*.{js,css,woff,woff2,ttf,png,svg,webp}'],
  globIgnores: ['**/node_modules/**', 'sw.js', 'workbox-*.js'],
  swDest: 'dist/sw.js',
  navigateFallback: '/index.html',
  navigateFallbackDenylist: [/^\/_expo\//, /^\/__expo/, /^\/api\//],
  cleanupOutdatedCaches: true,
  maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
};
