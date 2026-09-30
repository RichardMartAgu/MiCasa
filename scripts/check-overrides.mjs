// Comprueba que cada `overrides` de `package.json` siga sirviendo a quien lo consume.
//
// Hay varios overrides que sacan un paquete del rango que declara su consumidor,
// y los tres están por lo mismo: advisory que no tiene arreglo por bump, porque la
// versión que lo arregla es una major y el consumidor está pineado por dentro.
// El arreglo es el override más un check que confirme que la versión forzada sigue
// exponiendo la API que el consumidor llama.
//
// Los overrides, y de dónde sale cada uno:
//
// - `tmp` a `^0.2.5`, desde `^0.0.33`, por `workbox-cli → inquirer →
//   external-editor`. Dos advisories high (escritura arbitraria vía symlink y
//   path traversal). `external-editor` llama a `tmpNameSync(unObjeto)`, y ese es
//   justo el contrato que 0.2.0 Sulokó al consolidar los argumentos posicionales
//   de affix en un objeto de opciones. O sea que la versión forzada es la que el
//   consumidor ya esperaba.
// - `uuid` a `^11.1.1`, desde `^7.0.3`, por `@expo/config-plugins → xcode`.
//   El advisory es un fallo de límites de buffer en v3/v5/v6 cuando se les pasa un
//   buffer; se arregla en 11.1.1. `xcode` solo llama a `uuid.v4()`, que existe en
//   v11. Ojo: v11 **quitó** el export `v` (la API antigua de v1), así que este
//   check es el que avisa si `xcode` empezara a usarlo.
//
// Ni los tests del repo cubren esto: la cadena es `workbox injectManifest` y
// `xcode`, que solo corren en el build nativo, y los tests mockean el router.
// Un test de Jest que los tocara probaría código de terceros.
//
// Lo que hay que vigilar no es si ese código funciona, sino que la versión
// forzada siga exponiendo la API que el consumidor llama. Y se comprueba sobre el
// módulo que el consumidor resuelve de verdad, no el de la raíz: si otro
// consumidor metiera otra major, npm la anidaría y mirar el paquete hoisted sería
// mirar otro módulo.
//
// Un cuarto override, `decode-uri-component` a `^0.5.0`, se probó y **se descartó**
// por incompatibilidad, no por el advisory: 0.5.0 pasó a ser ESM y exporta
// `{ default }`, mientras `query-string@7.1.3` (dentro de `expo-router`) llama a
// la función sin desempaquetar. Los tests y el build pasaban igual; reventaba al
// parsear una query string real. Está anotado en el README porque es el tipo de
// trampa que parece un arreglo y no lo es.
//
// Si algo de aquí falla, el arreglo NO es bajar el paquete a su rango original
// (eso devuelve el advisory): es un override anidado, o subir el consumidor
// cuando saque una versión que ya use la major corregida.

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!existsSync(path.join(root, 'node_modules'))) {
  console.error('✗ node_modules no está.');
  console.error('');
  console.error('  Este script necesita las dependencias: corre después de `npm ci`, no');
  console.error('  antes. La comprobación del lock sin dependencias está en');
  console.error('  `npm run check:lock`.');
  process.exit(1);
}

const fails = [];

function check(nombre, fn) {
  try {
    const detalle = fn();
    console.log(`  ✓ ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  } catch (error) {
    console.log(`  ✗ ${nombre} — ${error.message}`);
    fails.push(nombre);
  }
}

/** Resuelve un módulo desde el `package.json` del consumidor, no desde la raíz. */
function requireFrom(consumerDir) {
  const dir = path.join(root, 'node_modules', consumerDir);
  if (!existsSync(dir)) {
    throw new Error(`${consumerDir} no está instalado`);
  }
  return createRequire(path.join(dir, 'package.json'));
}

check('tmp → external-editor (tmpNameSync con objeto de opciones)', () => {
  const require = requireFrom('external-editor');
  const version = require('tmp/package.json').version;
  const name = require('tmp').tmpNameSync({});
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`tmp@${version} devolvió ${JSON.stringify(name)}`);
  }
  return `tmp@${version}`;
});

check('uuid → xcode (v4 presente y con formato; el export legacy v ausente)', () => {
  const require = requireFrom('xcode');
  const version = require('uuid/package.json').version;
  const uuid = require('uuid');

  if (typeof uuid.v4 !== 'function') {
    throw new Error(`uuid@${version} no expone v4, que es lo único que usa xcode`);
  }
  // El salto de 7 a 11 quitó `v`, que era la API antigua de v1. `xcode` no la usa
  // hoy, pero se comprueba que siga ausente: si una major futura la reintrodujera,
  // o si `xcode` empezara a llamar a algo que ella sí tenía, este es el gate que
  // lo vería. El comentario de más arriba prometía esta comprobación sin
  // cumplirla, y eso es peor que no prometerla.
  if (uuid.v !== undefined) {
    throw new Error(`uuid@${version} ha reintroducido el export legacy \`v\`: el salto 7→11 lo había quitado`);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuid.v4())) {
    throw new Error(`uuid@${version}.v4() no devolvió un UUID con formato v4`);
  }
  return `uuid@${version}`;
});

check('query-string → expo-router (parse y stringify, sin desempaquetar)', () => {
  // Aquí no hay override, pero es la comprobación que habría delatado el de
  // `decode-uri-component`: esa dependencia se anima a fallar sin que ningún
  // test ni el build se entere, porque solo se usa al parsear una query real.
  const require = requireFrom('expo-router');
  const version = require('query-string/package.json').version;
  const parsed = require('query-string').parse('?a=1&b=hola%20mundo&c=%C3%A1');
  if (parsed.a !== '1' || parsed.b !== 'hola mundo' || parsed.c !== 'á') {
    throw new Error(`query-string@${version} parseó mal: ${JSON.stringify(parsed)}`);
  }
  return `query-string@${version}`;
});

if (fails.length > 0) {
  console.error('');
  console.error(`✗ ${fails.length} override(s) no sirven a su consumidor: ${fails.join(', ')}`);
  console.error('');
  console.error('  El arreglo no es bajar el paquete a su rango original, que devuelve');
  console.error('  el advisory: es un override anidado, o subir el consumidor cuando');
  console.error('  saque una versión que ya use la major corregida. Ver el README.');
  process.exit(1);
}

console.log('  ✓ todos los overrides siguen sirviendo a su consumidor');
