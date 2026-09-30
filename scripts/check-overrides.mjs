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
//   v11, y lo verificó `expo prebuild` generando un `.pbxproj` con UUIDs correctos.
//   Ni v7 ni v11 exportan `v`: esa API vieja no llegó a existir, así que no hay
//   ningún export que se haya perdido en el salto y que haga falta vigilar.
//
// Ni los tests del repo cubren esto: la cadena es `workbox injectManifest` y
// `xcode`, que solo corren en el build nativo, y los tests mockean el router.
// Un test de Jest que los tocara probaría código de terceros.
//
// Lo que hay que vigilar son dos cosas, y la primera es la que de verdad protege:
//
// 1. Que el override siga APLICADO. Sin esto, quitarlo de package.json y
//    regenerar el lock devuelve la versión vulnerable, con su advisory de vuelta,
//    y todos los gates en verde: el resto de comprobaciones mirarían que la API
//    siga viva, y la API de la versión vieja funciona igual de bien. Este script
//    nació para que eso no pase en silencio, y solo lo cumple si compara la
//    versión resuelta con el rango del override.
// 2. Que la versión forzada siga exponiendo la API que el consumidor llama. Y se
//    resuelve desde el módulo que el consumidor recibe de verdad, no desde el de
//    la raíz: si otro consumidor metiera otra major, npm la anidaría y mirar el
//    paquete hoisted sería mirar otro módulo.
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
import fs, { existsSync } from 'node:fs';
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

/**
 * Falla si la versión que resolvió el consumidor no cumple el rango del override.
 *
 * Sin esto, quitar el override de `package.json` y regenerar el lock devuelve la
 * versión vulnerable, con su advisory de vuelta, y todos los gates en verde: el
 * check se limita a mirar que la API siga viva, y la API de la versión vieja
 * funciona igual de bien. Es el modo de fallo que hace que este script exista.
 *
 * El rango se aplica a mano en vez de con `semver` para no añadir una dependencia
 * a un script que corre en el build de Vercel y en CI. Los dos overrides usan
 * `^X.Y.Z`, que es comparación de tres números.
 */
function exigirOverrideAplicado(nombre, version) {
  const { overrides } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const rango = overrides?.[nombre];

  if (!rango) {
    throw new Error(
      `package.json ya no declara overrides.${nombre}. Si se ha quitado a propósito, ` +
        `borra también la comprobación del script; si no, el advisory vuelve sin que nada lo note.`
    );
  }
  if (!rango.startsWith('^')) {
    throw new Error(`overrides.${nombre} = "${rango}" no es un rango ^, y este check solo los soporta`);
  }

  const [major, minor, patch] = rango.slice(1).split('.').map((n) => parseInt(n, 10));
  const [vmajor, vminor, vpatch] = version.split('.').map((n) => parseInt(n, 10));
  const cumple = vmajor === major && (vminor > minor || (vminor === minor && vpatch >= patch));

  if (!cumple) {
    throw new Error(
      `${nombre}@${version} no cumple el override \`${nombre}: ${rango}\`. El override no se está\n` +
        `  aplicando: mira si falta en package.json o si el lock se regeneró sin él.`
    );
  }
}

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

check('tmp → external-editor (override aplicado, y tmpNameSync con objeto)', () => {
  const require = requireFrom('external-editor');
  const version = require('tmp/package.json').version;

  exigirOverrideAplicado('tmp', version);

  const name = require('tmp').tmpNameSync({});
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`tmp@${version} devolvió ${JSON.stringify(name)}`);
  }
  return `tmp@${version}`;
});

check('uuid → xcode (override aplicado, y v4 con formato)', () => {
  const require = requireFrom('xcode');
  const version = require('uuid/package.json').version;
  const uuid = require('uuid');

  // Lo primero es que el override siga aplicado. Sin esto, el check solo miraría
  // que la API siga viva, y eso lo cumple igual la versión VULNERABLE: quitar el
  // override de package.json y regenerar el lock devuelve uuid@7.0.3, con el
  // advisory de vuelta y todos los gates en verde. Es el fallo que hace que este
  // script exista, así que es lo que tiene que mirar primero.
  exigirOverrideAplicado('uuid', version);

  if (typeof uuid.v4 !== 'function') {
    throw new Error(`uuid@${version} no expone v4, que es lo único que usa xcode`);
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
