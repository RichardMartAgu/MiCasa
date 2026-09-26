// Verificación estática del build PWA (sin navegador: no hay libs del sistema).
const fs = require('fs');
const path = require('path');

const DIST = process.argv[2] || path.join(__dirname, '..', 'dist');
const fail = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : fail.push(msg));

// ---------- manifest ----------
const manifest = JSON.parse(
  fs.readFileSync(path.join(DIST, 'manifest.webmanifest'), 'utf8')
);

check(!!manifest.name, `manifest.name = ${manifest.name}`);
check(!!manifest.short_name && manifest.short_name.length <= 12, `manifest.short_name = ${manifest.short_name}`);
check(!!manifest.description, 'manifest.description presente');
check(manifest.display === 'standalone', `manifest.display = ${manifest.display}`);
check(manifest.start_url === '/', `manifest.start_url = ${manifest.start_url}`);
check(manifest.scope === '/', `manifest.scope = ${manifest.scope}`);
check(manifest.id === '/', `manifest.id = ${manifest.id}`);
check(manifest.orientation === 'portrait', `manifest.orientation = ${manifest.orientation}`);
check(/^#[0-9A-Fa-f]{6}$/.test(manifest.theme_color), `manifest.theme_color = ${manifest.theme_color}`);
check(/^#[0-9A-Fa-f]{6}$/.test(manifest.background_color), `manifest.background_color = ${manifest.background_color}`);

const anyIcons = manifest.icons.filter((i) => (i.purpose || 'any').split(' ').includes('any'));
const maskable = manifest.icons.filter((i) => (i.purpose || '').split(' ').includes('maskable'));
check(anyIcons.some((i) => i.sizes === '192x192'), 'icon any 192x192 declarado');
check(anyIcons.some((i) => i.sizes === '512x512'), 'icon any 512x512 declarado');
check(maskable.some((i) => i.sizes === '512x512'), 'icon maskable 512x512 declarado');

// Los ficheros de iconos existen y su tamaño real coincide con lo declarado
for (const icon of manifest.icons) {
  const file = path.join(DIST, icon.src.replace(/^\//, ''));
  const exists = fs.existsSync(file);
  check(exists, `fichero de icono presente: ${icon.src}`);
  if (exists) {
    const buf = fs.readFileSync(file);
    //IHDR: ancho/alto en bytes 16..24
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    const declared = icon.sizes.split('x').map(Number);
    check(
      width === declared[0] && height === declared[1],
      `${icon.src} mide ${width}x${height} y declara ${icon.sizes}`
    );
    check(buf.length > 1000, `${icon.src} pesa ${buf.length} B`);
  }
}
check(fs.existsSync(path.join(DIST, 'apple-touch-icon.png')), 'apple-touch-icon.png presente');

// ---------- index.html ----------
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
check(!html.includes('%LANG_ISO_CODE%') && !html.includes('%WEB_TITLE%'), 'sin placeholders sin resolver');
check(/<html lang="es"/.test(html), 'html lang="es"');
check(html.includes('href="/manifest.webmanifest"'), 'link al manifest');
check(html.includes('name="theme-color" content="#0B1220"'), 'meta theme-color Dusk');
check(html.includes('rel="apple-touch-icon"'), 'apple-touch-icon enlazado');
check(html.includes('apple-mobile-web-app-capable'), 'meta apple-mobile-web-app-capable');
check(html.includes("navigator.serviceWorker.register('/sw.js')"), 'registro del service worker en el HTML');
check(html.includes("method: 'HEAD'"), 'registro del SW protegido por comprobación de Content-Type');
check(html.includes('id="expo-reset"'), 'ScrollViewStyleReset / expo-reset presente (layout RN Web)');
check(html.includes('<div id="root">'), 'div root presente');
check(html.includes('expo-reset'), 'estilos expo-reset conservados');
check(/_expo\/static\/js\/web\/entry-[a-f0-9]+\.js/.test(html), 'bundle de la app enlazado');

// ---------- service worker ----------
const swFile = path.join(DIST, 'sw.js');
check(fs.existsSync(swFile), 'dist/sw.js generado');
const sw = fs.readFileSync(swFile, 'utf8');

check(sw.includes('precacheAndRoute('), 'manifiesto de precache inyectado por Workbox');

// El manifiesto de precache lo inyecta Workbox en la llamada a precacheAndRoute:
// en modo injectManifest es un array JSON con claves entrecomilladas.
// Se usa la última llamada: el bundle también incluye la definición interna de
// precacheAndRoute de Workbox, que recibe un identificador de módulo.
const calls = [...sw.matchAll(/precache(?:AndRoute)?\(\[([\s\S]*?)\](?:,\s*\{[^}]*\})?\)/g)];
const revisionMatch = calls.length > 0 ? calls[calls.length - 1] : null;
let precacheEntries = [];
if (revisionMatch) {
  try {
    precacheEntries = JSON.parse(`[${revisionMatch[1]}]`);
  } catch (error) {
    // Workbox minificado: claves sin comillas, se leen a mano.
    const pairRe = /"?url"?:\s*"([^"]+)",\s*"?revision"?:\s*"([^"]+)"/g;
    let m;
    while ((m = pairRe.exec(revisionMatch[1])) !== null) {
      precacheEntries.push({ url: m[1], revision: m[2] });
    }
  }
}
check(precacheEntries.length > 0, `entradas de precache parseadas: ${precacheEntries.length}`);

const urls = precacheEntries.map((e) => e.url.replace(/^\//, ''));
for (const expected of [
  'index.html',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',
]) {
  check(urls.includes(expected), `precache incluye ${expected}`);
}
check(
  urls.some((u) => u.startsWith('_expo/static/js/web/entry-')),
  'precache incluye el bundle de la app'
);
check(
  !urls.some((u) => u.endsWith('.map')),
  'precache sin ficheros .map'
);
check(
  !urls.some((u) => /supabase|googleapis|gstatic|fonts\./i.test(u)),
  'precache sin recursos externos (Supabase, fuentes, etc.)'
);
check(
  !urls.some((u) => u.startsWith('_expo/static/js/ios/') || u.startsWith('_expo/static/js/android/')),
  'precache solo con assets web'
);
check(
  precacheEntries.every((e) => typeof e.revision === 'string' && e.revision.length > 0),
  'todas las entradas de precache llevan revisión (actualización al desplegar)'
);

check(
  /createHandlerBoundToURL\(\s*["']\/index\.html["']/.test(sw),
  'navigateFallback al shell /index.html'
);
check(sw.includes('/^\\/_expo\\//'), 'denylist de navegación con /_expo/');
check(sw.includes('/^\\/api\\//'), 'denylist de navegación con /api/');
check(
  /cleanupOutdatedCaches\(\)\s*;/.test(sw),
  'cleanupOutdatedCaches invocado al activar'
);
// La activación del service worker nuevo.
//
// Antes esta guarda exigía NO tener `skipWaiting` ni el mensaje `SKIP_WAITING`,
// y el motivo era bueno: activar el worker nuevo con pestañas viejas abiertas
// puede hacer que esa página pida un bundle que el despliegue anterior ya borró.
//
// El problema es que esa prohibition, sin más, era un atasco. Sin activación
//Automática, un worker nuevo espera a que se cierren TODOS sus clientes, y con
// la app instalada siempre hay uno vivo: medido, el usuario se quedaba con el
// bundle de su primer despliegue indefinidamente, sin que nada lo dijera, y sus
// pruebas reportaban bugs de código que ya no estaba en producción.
//
// Lo que se exige ahora es lo que de verdad hay que garantizar: que la activación
// NO sea automática. O sea, que `skipWaiting` no se llame al instalar el worker,
// y que solo se llame desde un mensaje que la app manda cuando alguien pulsa
// "Recargar". Con eso el control cambia cuando alguien lo pide, y la página se
// recarga acto seguido en el `controllerchange`, así que no hay pestaña vieja
// trabajando con el worker nuevo.
// La invariante real es "la única llamada a `skipWaiting` es la del listener
// `message` que comprueba SKIP_WAITING", y eso se comprueba por recuento. La
// versión anterior usaba `addEventListener('install'[\s\S]{0,200}skipWaiting`, que
// pasaba por distancia entre Workbox y nuestro código, no porque la invariante se
// cumpliera: un `install` con un cuerpo de más de 200 caracteres, o un
// `skipWaiting` dentro de una función llamada desde `install`, se colaban sin que
// lo detectara.
const llamadasSkipWaiting = (sw.match(/skipWaiting\s*\(/g) ?? []).length;
check(llamadasSkipWaiting === 1, 'skipWaiting se llama exactamente una vez en el worker');
check(
  /addEventListener\(\s*["']message["'][\s\S]{0,400}SKIP_WAITING["'][\s\S]{0,200}skipWaiting\s*\(/.test(sw),
  'la unica llamada a skipWaiting esta en el listener message, tras comprobar SKIP_WAITING'
);
check(
  !/addEventListener\(\s*["']install["'][\s\S]{0,200}skipWaiting/.test(sw),
  'el worker nuevo no se activa solo al instalarse: la activacion la pide la persona'
);
// El mensaje lo manda la app, y la app no está en el HTML sino en el bundle. Se
// lee el bundle del propio dist: si este script pasa, es porque el código que
//Environments se despliega sí lo manda.
const bundle = fs
  .readdirSync(path.join(DIST, '_expo', 'static', 'js', 'web'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => fs.readFileSync(path.join(DIST, '_expo', 'static', 'js', 'web', f), 'utf8'))
  .join('\n');
check(
  /postMessage\(\{\s*type:\s*["']SKIP_WAITING["']/.test(bundle),
  'la app manda el mensaje SKIP_WAITING al pulsar Recargar'
);

// ---------- Web Push en el service worker ----------
check(
  !/^\s*import\s/m.test(sw),
  'el service worker es un script clasico (sin imports ESM, que el navegador rechaza)'
);
check(
  /addEventListener\(\s*["']push["']/.test(sw),
  'listener de push registrado: los avisos llegan con la app cerrada'
);
check(
  /addEventListener\(\s*["']notificationclick["']/.test(sw),
  'listener de notificationclick registrado: el aviso abre la app'
);
check(sw.includes('showNotification'), 'showNotification presente para pintar el aviso');
check(
  /self\.registration\.showNotification|registration\.showNotification/.test(sw),
  'el aviso se muestra desde la propia registro del SW'
);
check(
  sw.includes('/citas') && sw.includes('/cumpleanos'),
  'la allowlist de rutas del aviso incluye las pantallas de citas y cumpleaños'
);
check(
  !/openWindow\(\s*data\.url\s*\)/.test(sw),
  'no se abre la URL del payload sin filtrar: pasa por la allowlist'
);
check(
  /userVisibleOnly|renotify/.test(sw),
  'el aviso declara renotify, necesario para que los navegadores lo acepten'
);

// Sin runtimeCaching para APIs: los datos del usuario no se guardan en caché
const strategies = sw.match(/e\.(NetworkFirst|StaleWhileRevalidate|CacheFirst)\(/g) || [];
check(
  strategies.length === 0,
  `sin runtimeCaching de APIs/recursos remotos (estrategias encontradas: ${strategies.length})`
);

console.log('OK:');
for (const m of ok) console.log('  ✓ ' + m);
if (fail.length) {
  console.log('\nFALLOS:');
  for (const m of fail) console.log('  ✗ ' + m);
  process.exit(1);
}
console.log(`\nTodo correcto (${ok.length} comprobaciones).`);
