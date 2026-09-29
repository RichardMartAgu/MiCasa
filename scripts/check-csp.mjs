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
// secretos no se escriben en disco durante el build. En local, en cambio, Expo
// carga el `.env` por su cuenta al compilar (lleva `@expo/env`, que hace dotenv
// con `parseEnv`), así que el fichero es la fuente normal. Por eso se mira
// `process.env` primero y se cae a `.env`: cada sitio lee de donde tiene.
let raw = process.env.EXPO_PUBLIC_SUPABASE_URL;

if (!raw) {
  const envPath = path.join(root, '.env');
  if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, 'utf8');
    // El `export` de delante se acepta porque es sintaxis válida de .env y hay
    // gente que la usa. Sin él, un .env con export se saltaba en silencio.
    const match = env.match(/^(?:export\s+)?EXPO_PUBLIC_SUPABASE_URL\s*=\s*(.+)$/m);
    if (match) raw = match[1];
  }
}

// Se limpia una sola vez y para los dos caminos: `.env` admite
// `URL="https://..."` y `URL=https://...  # nota`, y alguien puede exportar la
// variable con las comillas puestas. Sin esto, el `new URL` de abajo revienta con
// un TypeError en vez de decir qué pasa.
raw = (raw || '').replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '');

if (!raw) {
  // Fallar es lo correcto aquí, no avisar. Sin origen contra el que comparar la
  // CSP no se ha verificado nada, y el exit 0 daba un OK que no significaba
  // nada justo en los dos sitios donde el guard dice proteger.
  //
  // El único caso legítimo para no tenerla es el clon recién hecho, que todavía
  // no ha copiado el .env. Pero ese clon tampoco construye bien: `supabase.ts`
  // lanza en el `if`, luego el build termina con exit 0 y despliega un bundle
  // con `createClient('', '')`, que revienta al abrir la app. O sea, avisar
  // ahí no evita una app rota, solo la esconde detrás de un verde. Por eso el
  // escape es explícito y opt-in.
  if (process.env.CSP_CHECK_OPTIONAL === '1') {
    console.log('  ! sin EXPO_PUBLIC_SUPABASE_URL: se omite (CSP_CHECK_OPTIONAL=1)');
    process.exit(0);
  }
  fail('EXPO_PUBLIC_SUPABASE_URL no está ni en process.env ni en .env, así que la CSP no se puede verificar.\n\n  El build necesita las variables de Supabase (ver .env.example). Si estás en un clon nuevo y solo quieres\n  comprobar que la sintaxis de la CSP es válida, usa CSP_CHECK_OPTIONAL=1.');
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

// La anon key no aparece en la CSP (no hace falta: viaja en cabeceras, no en un
// origen), pero `supabase.ts` lanza sin ella igual que sin la URL, con el mismo
// resultado: build verde y app rota al abrir. Se comprueba por el mismo motivo.
const envText = (() => {
  const envPath = path.join(root, '.env');
  return fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
})();
const anonPresent = Boolean(
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
    envText.match(/^(?:export\s+)?EXPO_PUBLIC_SUPABASE_ANON_KEY\s*=\s*(\S+)/m)
);

check(
  'EXPO_PUBLIC_SUPABASE_ANON_KEY está presente',
  anonPresent,
  'sin la anon key el build termina bien pero la app falla al abrir: supabase.ts lanza con createClient("", "")'
);

console.log('  ✓ la CSP de vercel.json coincide con el proyecto de Supabase');
