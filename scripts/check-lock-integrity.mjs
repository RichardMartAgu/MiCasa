// Comprueba que `package-lock.json` conserva los hashes de integridad.
//
// Por qué: en el commit 8de2a85 el lock pasó de 1809 claves `integrity` a 1.
// Sin ellas, `npm ci` sigue fijando versiones, pero no verifica el contenido de
// lo que descarga: instala lo que el registry sirva en ese momento. Y como
// `master` mergea los PRs de dependabot sin que nadie mire, y tanto CI como el
// build de Vercel usan `npm ci`, un paquete transitivo comprometido llegaría a
// `node_modules` sin que nada lo notara.
//
// La causa de aquel cambio no está del todo clara, pero se sabe reproducir:
// cuando `node_modules` ya existe y npm resuelve desde su caché local, escribe
// las entradas del lock solo con `version`, sin volver a pedir los metadatos al
// registry. Regenerar con `node_modules` borrado y una caché nueva lo arregla
// (1823 de 1824). Este script vigila que no vuelva a pasar.
//
// No comprueba los hashes contra los tarballs, que es lo que hace `npm ci`. Solo
// avisa de que el lock se ha quedado sin ellos, que es el síntoma temprano.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = path.join(root, 'package-lock.json');

const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
const entries = Object.entries(lock.packages ?? {});

// La entrada raíz no es un paquete instalado, es el proyecto.
const installed = entries.filter(([key]) => key !== '');
const withIntegrity = installed.filter(([, value]) => typeof value.integrity === 'string');

if (installed.length === 0) {
  console.error('✗ package-lock.json no tiene entradas de paquetes.');
  process.exit(1);
}

const ratio = withIntegrity.length / installed.length;

console.log(`  paquetes en el lock: ${installed.length}`);
console.log(`  con hash de integridad: ${withIntegrity.length}`);

if (ratio >= 0.99) {
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
console.error('    rm -rf node_modules package-lock.json');
console.error('    npm install --cache /tmp/npm-cache-fresco');
console.error('');
console.error(`  Paquetes sin hash: ${installed.length - withIntegrity.length} de ${installed.length}`);
const sample = installed
  .filter(([, value]) => typeof value.integrity !== 'string')
  .slice(0, 5)
  .map(([key]) => key)
  .join('\n    ');
console.error(`    ${sample}`);
process.exit(1);
