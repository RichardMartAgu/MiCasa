// Comprueba que el `overrides` de `tmp` siga sirviendo a quien lo consume.
//
// Hay un `overrides: { tmp: ^0.2.5 }` en package.json que saca a `tmp` del rango
// que declara su único consumidor: `external-editor@3.1.0` pide `^0.0.33`, que es
// `>=0.0.33 <0.0.34`, y se le fuerza `0.2.7`. El motivo está en el README: sin el
// override, `tmp@0.0.33` arrastra dos advisories *high* y el gate de auditoría del
// árbol de build no podría estar en `high`.
//
// Esta comprobación va en su propio script, y no dentro de
// `check-lock-integrity.mjs`, por una razón concreta: este necesita
// `node_modules`, y aquel se ejecuta ANTES de `npm ci`, en un runner limpio. Meter
// un `require` aquí dentro dejó el CI de todos los pushes en rojo.
//
// Ni los tests del repo cubren esto: la cadena es `workbox-cli` → `inquirer` →
// `external-editor` → `tmp`, que es la CLI interactiva de workbox, y aquí solo se
// usa `workbox injectManifest`, que no la carga. Un test de Jest que la tocara
// tendría que lanzar un editor real sobre una TTY: lento y frágil en CI.
//
// Lo que hay que vigilar no es si ese código funciona, sino que la versión
// forzada siga exponiendo la API que el consumidor llama. Y se comprueba sobre el
// módulo que el consumidor resuelve de verdad, no el de la raíz: si otro
// consumidor metiera otra major de `tmp`, npm la anidaría y mirar el `tmp`
// hoisted sería mirar otro módulo.
//
// Si esto falla, el arreglo NO es volver a `^0.0.33` (vuelve el advisory high):
// es un `overrides` anidado, o subir `workbox-cli` cuando saque una versión que ya
// use `tmp` en 0.2.x y dejar el override como redundante.

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// El consumidor del override, no `tmp` directamente: así se comprueba el módulo
// que `external-editor` recibe, con su anidamiento si lo hubiera.
const consumer = path.join(root, 'node_modules', 'external-editor');

if (!existsSync(consumer)) {
  console.error('✗ external-editor no está instalado.');
  console.error('');
  console.error('  Este script necesita `node_modules`: corre después de `npm ci`, no');
  console.error('  antes. La comprobación del lock sin dependencias está en');
  console.error('  `npm run check:lock`.');
  process.exit(1);
}

const require = createRequire(path.join(consumer, 'package.json'));

let tmp;
try {
  tmp = require('tmp');
} catch (error) {
  console.error(`✗ No se pudo cargar tmp desde external-editor: ${error.message}`);
  console.error('');
  console.error('  El `overrides` de package.json puede estar apuntando a una versión');
  console.error('  que no se resuelve. Revisa el lock y corre `npm ci`.');
  process.exit(1);
}

let version;
try {
  version = require('tmp/package.json').version;
} catch {
  console.log('  ! no se pudo leer la versión de tmp; se comprueba solo la API');
}

// `external-editor/main/index.js` llama exactamente a esto, con un único objeto de
// opciones. Es la llamada cuyo contrato cambió en `tmp` 0.2.0, así que es la que
// delata un override incompatible.
let name;
try {
  name = tmp.tmpNameSync({});
} catch (error) {
  console.error(`✗ tmp@${version ?? '?'} no expone tmpNameSync como la usa external-editor: ${error.message}`);
  console.error('');
  console.error('  El `overrides` de tmp es incompatible con su consumidor. El arreglo');
  console.error('  no es bajar tmp a 0.0.x (eso devuelve el advisory high), sino un');
  console.error('  override anidado o subir workbox-cli. Ver el README.');
  process.exit(1);
}

if (typeof name !== 'string' || name.length === 0) {
  console.error(`✗ tmp@${version ?? '?'} devolvió un nombre no utilizable: ${JSON.stringify(name)}`);
  process.exit(1);
}

console.log(`  tmp@${version ?? '?'}: tmpNameSync funciona para external-editor`);
console.log('  ✓ el override de tmp sigue sirviendo a su consumidor');
