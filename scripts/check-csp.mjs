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

// El origen real viene del .env que usa el build. Sin él no se puede comprobar
// nada, y es un caso legítimo (instalación recién hecha, documentación): en vez
// de fallar se avisa, porque el build de Vercel sí lo tiene.
const envPath = path.join(root, '.env');
if (!fs.existsSync(envPath)) {
  console.log('  ! sin .env: no se puede comprobar la CSP contra el origen real');
  process.exit(0);
}

const env = fs.readFileSync(envPath, 'utf8');
const match = env.match(/^EXPO_PUBLIC_SUPABASE_URL\s*=\s*(\S+)/m);
if (!match) {
  console.log('  ! sin EXPO_PUBLIC_SUPABASE_URL en .env: se omite la comprobación');
  process.exit(0);
}

const url = new URL(match[1]);
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
