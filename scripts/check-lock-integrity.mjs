// Comprueba que `package-lock.json` conserva los hashes de integridad.
//
// Por qué: en el commit 8de2a85 el lock pasó de 1809 claves `integrity` a 1.
// Sin ellas, `npm ci` sigue fijando versiones, pero no verifica el contenido de
// lo que descarga: instala lo que el registry sirva en ese momento. Y como
// `master` es la rama por defecto, así que dependabot abre ahí, y tanto CI como
// el build de Vercel usan `npm ci`: un paquete transitivo comprometido llegaría a
// `node_modules` sin que nada lo notara. Hoy no hay automerge
// (`allow_auto_merge = false`), pero el lock es la base de los dos, y este
// comprueba esa base.
//
// La causa de aquel cambio se sabe reproducir: cuando `node_modules` ya existe y
// npm resuelve desde su caché local, escribe las entradas del lock solo con
// `version`, sin volver a pedir los metadatos al registry. Regenerar con
// `node_modules` borrado y una caché nueva lo arregla.
//
// Este script solo usa `node:fs`, `node:path` y `node:url`, a propósito: se
// ejecuta ANTES de `npm ci`, en un runner donde no hay `node_modules`. Anything
// que necesite dependencias va en el script hermano `check-overrides.mjs`.
//
// No comprueba los hashes contra los tarballs, que es lo que hace `npm ci`. Solo
// avisa de que el lock se ha quedado sin ellos, que es el síntoma temprano.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = path.join(root, 'package-lock.json');

const REGEN =
  '    rm -rf node_modules package-lock.json\n' +
  '    npm install --cache /tmp/npm-cache-fresco';

if (!fs.existsSync(lockPath)) {
  console.error('✗ No hay package-lock.json.');
  console.error('');
  console.error('  Sin lock, `npm ci` no puede fijar nada y el build instala lo que');
  console.error('  le apetezca. Para generarlo:');
  console.error('');
  console.error(REGEN);
  process.exit(1);
}

let lock;
try {
  lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
} catch (error) {
  console.error(`✗ package-lock.json no es JSON válido: ${error.message}`);
  console.error('');
  console.error('  Un lock corrupto hace que `npm ci` falle, pero con un error que no');
  console.error('  dice nada de por qué. Para regenerarlo:');
  console.error('');
  console.error(REGEN);
  process.exit(1);
}

const entries = Object.entries(lock.packages ?? {});

// La entrada raíz no es un paquete instalado, es el proyecto. De las demás se
// excluyen las que legítimamente no llevan hash (enlaces locales, workspaces):
// contarlas en el denominador obligaría a tolerar un porcentaje de fallsos que
// solo existiría por ellas, y esa tolerancia dejaría pasar paquetes de verdad
// sin verificar. Hoy el lock no tiene ninguna, así que el ratio es 1 y el umbral
// puede estar en 100% sin falsos rojos.
//
// Los tres casos que se excluyen, por qué no llevan hash y cómo los reconoce npm:
// - `link: true`: un workspace del monorepo. Su `resolved` es una ruta relativa
//   ("packages/foo"), no un URL, así que buscar solo prefijos de protocolo no lo
//   habría pillado.
// - `inBundle: true`: dependencia empaquetada dentro de otra. No tiene resolved
//   ni integrity, porque no se descarga aparte.
// - `resolved` con esquema file:/link:: dependencia local.
//
// Lo que NO se excluye, a propósito: si falta `resolved`, la entrada cuenta como
// remota y sin hash, y el gate falla. Ese es exactamente el camino de la regresión
// de 8de2a85, así que es el que tiene que seguir cortando.
const isLocal = (value) =>
  value.link === true ||
  value.inBundle === true ||
  (typeof value.resolved === 'string' &&
    (value.resolved.startsWith('file:') || value.resolved.startsWith('link:')));

const installed = entries.filter(([key]) => key !== '');
const remote = installed.filter(([, value]) => !isLocal(value));
const withIntegrity = remote.filter(([, value]) => typeof value.integrity === 'string');

if (remote.length === 0) {
  console.error('✗ package-lock.json no tiene entradas de paquetes de registry.');
  process.exit(1);
}

const ratio = withIntegrity.length / remote.length;

console.log(`  paquetes en el lock: ${installed.length}`);
if (installed.length !== remote.length) {
  console.log(`  locales (sin hash por diseño): ${installed.length - remote.length}`);
}
console.log(`  con hash de integridad: ${withIntegrity.length} de ${remote.length} de registry`);

// Además del ratio, el lock tiene que seguir siendo completo. Un lock truncado
// con 100 entradas, todas con hash, daba un ✓ antes: el ratio es 1 pero el
// paquete se ha instalado a medias. `npm ci` lo caza después con un EUSAGE, así
// que esto es defensa en profundidad, no el único control.
const declared = new Set([
  ...Object.keys(lock.packages?.root?.dependencies ?? {}),
  ...Object.keys(lock.packages?.['']?.dependencies ?? {}),
  ...Object.keys(lock.packages?.['']?.devDependencies ?? {}),
]);

const missing = [...declared].filter((name) => !lock.packages[`node_modules/${name}`]);
if (missing.length > 0) {
  console.error('');
  console.error(`✗ El lock declara ${missing.length} dependencia(s) directa(s) que no están resueltas:`);
  for (const name of missing.slice(0, 10)) console.error(`    ${name}`);
  console.error('');
  console.error('  El lock no está sincronizado con package.json. `npm ci` fallaría.');
  console.error('  Para regenerarlo:');
  console.error('');
  console.error(REGEN);
  process.exit(1);
}

if (ratio === 1) {
  console.log('  ✓ el lock verifica el contenido de lo que descarga');
  process.exit(0);
}

console.error('');
console.error(`✗ Solo el ${(ratio * 100).toFixed(1)}% de los paquetes tiene hash de integridad.`);
console.error('');
console.error('  Sin `integrity`, `npm ci` fija versiones pero NO verifica el contenido:');
console.error('  instala lo que el registry sirva, y un paquete comprometido pasa');
console.error('  desapercibido. Se sabe reproducir cuando `node_modules` ya existe y');
console.error('  npm resuelve desde su caché: escribe las entradas solo con `version`.');
console.error('');
console.error('  Para regenerarlo bien:');
console.error('');
console.error(REGEN);
console.error('');
console.error(`  Paquetes sin hash: ${remote.length - withIntegrity.length} de ${remote.length}`);
const sample = installed
  .filter(([, value]) => !isLocal(value) && typeof value.integrity !== 'string')
  .slice(0, 5)
  .map(([key]) => key)
  .join('\n    ');
console.error(`    ${sample}`);
process.exit(1);
