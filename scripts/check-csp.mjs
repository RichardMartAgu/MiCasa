// Comprueba que la CSP de `vercel.json` sigue coincidiendo con el proyecto de
// Supabase que se está construyendo.
//
// El problema que esto evita: la CSP no puede leer variables de entorno, así que
// el origen de Supabase está escrito a mano en `vercel.json`, mientras que la app
// lo saca de `EXPO_PUBLIC_SUPABASE_URL` en build. Si alguien cambia de proyecto
// (o cambia la URL en el dashboard) la app empieza a apuntar a un sitio al que la
// CSP no deja conectar, y el síntoma es que no llegan datos y no hay ni un error
// en consola: la petición se bloquea antes de salir. Aquí el build falla en su
// lugar.
//
// Solo verifica, no genera. La alternativa (que el script reescriba `vercel.json`)
// metería churn en el repo en cada build, que es peor que un archivo que se
// edita a mano cuando toca.
//
// Falla el build (código 1) si hay desajuste, así que CI lo ve antes que Vercel.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  console.error(`✗ CSP desalineada: ${message}`);
  console.error('');
  console.error('  La CSP de vercel.json está pineada a mano y la app lee su origen de');
  console.error('  EXPO_PUBLIC_SUPABASE_URL. Si has cambiado de proyecto de Supabase,');
  console.error('  actualiza las dos directivas connect-src en vercel.json:');
  console.error('');
  console.error("    connect-src 'self' <URL> wss://<host>");
  console.error('');
  process.exit(1);
}

function check(name, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    fail(detail);
  }
}

// El origen real llega por dos caminos distintos y hay que mirar los dos.
//
// En CI y en Vercel las variables están en `process.env`, no en un fichero: los
// secretos no se escriben en disco durante el build. Si este script solo leyera
// `.env` se saltaría entero justo donde dice proteger, con un exit 0 que parece
// un OK. En local es al revés: `expo export` tampoco lee `.env` salvo que se
// exporte al entorno, y el fichero suele estar.
//
// Así que se consulta `process.env` primero y, si no está, se cae a `.env`.
// Solo si no aparece por ninguno de los dos lados se avisa y se sale con 0: sin
// origen contra el que comparar no hay nada que verificar, y fallar ahí
// bloquearía una instalación recién hecha.
let raw = process.env.EXPO_PUBLIC_SUPABASE_URL;

if (!raw) {
  const envPath = path.join(root, '.env');
  if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, 'utf8');
    const match = env.match(/^EXPO_PUBLIC_SUPABASE_URL\s*=\s*(.+)$/m);
    if (match) raw = match[1];
  }
}

// Se limpia una sola vez y para los dos caminos: `.env` admite
// `URL="https://..."` y `URL=https://...  # nota`, y alguien puede exportar la
// variable con las comillas puestas. Sin esto, el `new URL` de abajo revienta con
// un TypeError en vez de decir qué pasa.
raw = (raw || '').replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '');

if (!raw) {
  console.log('  ! sin EXPO_PUBLIC_SUPABASE_URL (ni en process.env ni en .env): se omite');
  process.exit(0);
}

let url;
try {
  url = new URL(raw);
} catch {
  fail(`EXPO_PUBLIC_SUPABASE_URL no es una URL válida: ${raw}`);
}

const origin = url.origin;
const wss = origin.replace(/^https:/, 'wss:');

let vercel;
try {
  vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
} catch (error) {
  console.error('✗ vercel.json no es JSON válido:', error.message);
  process.exit(1);
}

const global = (vercel.headers || []).find((h) => h.source === '/(.*)');
const cspHeader = (global?.headers || []).find(
  (h) => h.key === 'Content-Security-Policy'
);

check(
  'vercel.json declara Content-Security-Policy',
  Boolean(cspHeader),
  'no hay cabecera CSP en el bloque /(.*)'
);

const connect = (cspHeader.value.match(/connect-src\s+([^;]+)/) || [])[1] || '';

check(
  `connect-src permite ${origin}`,
  connect.split(/\s+/).includes(origin),
  `connect-src no incluye el origen que usa la app.\n\n    connect-src actual: ${connect}\n    origen esperado:   ${origin}`
);

check(
  `connect-src permite ${wss} (Realtime)`,
  connect.split(/\s+/).includes(wss),
  `connect-src no incluye la variante wss, así que Realtime se bloquearía en silencio.\n\n    connect-src actual: ${connect}\n    esperado:          ${wss}`
);

check(
  'script-src-attr bloquea los handlers inline',
  /script-src-attr\s+'none'/.test(cspHeader.value),
  "script-src-attr no está en 'none', así que onclick= y similares quedan permitidos"
);

console.log('  ✓ la CSP de vercel.json coincide con el proyecto de Supabase');
