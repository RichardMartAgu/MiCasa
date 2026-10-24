// Gate de `npm audit` con una allowlist explícita y caducable.
//
// Por qué existe: dos advisories *high* del árbol de Expo no tienen parche
// publicado. `npm audit --audit-level=high` los bloquea igual, así que sin esta
// lista el CI queda rojo para siempre y el gate deja de distinguir un advisory
// nuevo de uno ya revisado.
//
// Lo que NO hace: silenciar el gate. Cualquier advisory *high* o *critical* que
// no esté en ALLOWLIST rompe el paso, y una entrada caducada también. La fecha
// obliga a volver a mirar si Expo o node-forge ya publicaron el arreglo.
//
// Se ejecuta con los mismos argumentos que `npm audit`:
//
//   node scripts/check-audit.mjs --omit=dev   # árbol de producción
//   node scripts/check-audit.mjs              # árbol completo
//
// Si `npm audit` falla por red o por un informe que no es JSON, el script falla:
// no se interpreta un fallo de herramienta como "sin hallazgos".

import { spawnSync } from 'node:child_process';

/**
 * Advisories aceptados a propósito. Cada uno necesita motivo y fecha de revisión.
 *
 * `reviewBy` es un día ISO. Cuando llegue, este script falla aunque el advisory
 * siga igual: es el recordatorio de comprobar si ya hay versión corregida.
 */
const ALLOWLIST = [
  {
    ghsa: 'GHSA-86w9-cpqp-85rv',
    package: 'node-forge',
    severity: 'high',
    reason:
      'node-forge@1.4.0 es la última versión publicada; el fix está en el PR 1152 ' +
      'de digitalbazaar/forge pero no tiene release. Llega por @expo/cli → ' +
      '@expo/code-signing-certificates, solo en el build de Android.',
    reviewBy: '2027-01-31',
  },
  {
    ghsa: 'GHSA-mrhx-c7xc-m3w5',
    package: 'zod',
    severity: 'high',
    reason:
      'zod@3.25.76 lo fija @expo/cli@57 (y zod@4.6.5 entra por eslint-config-expo); ' +
      'el advisory solo se corrige en zod 4.6.6. Forzar la major rompe el CLI de ' +
      'Expo; se revisa al subir de SDK.',
    reviewBy: '2027-01-31',
  },
];

const FORMATO_GHSA = /^GHSA(-[a-z0-9]{4}){3}$/i;
const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const SEVERIDADES = new Set(['info', 'low', 'moderate', 'high', 'critical']);

/** Fecha ISO real, no solo con forma de fecha (`2027-02-31` no vale). */
function esFechaISO(valor) {
  if (typeof valor !== 'string' || !FORMATO_FECHA.test(valor)) return false;
  const fecha = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
}

/** Una allowlist mal escrita no puede desactivar la caducidad en silencio. */
function validarAllowlist() {
  const errores = [];
  const vistosGhsa = new Set();

  for (const [indice, entrada] of ALLOWLIST.entries()) {
    const donde = `ALLOWLIST[${indice}]`;
    if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
      errores.push(`${donde} no es un objeto`);
      continue;
    }
    if (!FORMATO_GHSA.test(entrada.ghsa ?? '')) errores.push(`${donde}.ghsa no es un GHSA válido`);
    if (vistosGhsa.has(entrada.ghsa)) errores.push(`${donde}.ghsa está duplicado`);
    vistosGhsa.add(entrada.ghsa);
    if (typeof entrada.package !== 'string' || entrada.package.length === 0) {
      errores.push(`${donde}.package está vacío`);
    }
    if (entrada.severity !== 'high' && entrada.severity !== 'critical') {
      errores.push(`${donde}.severity debe ser high o critical`);
    }
    if (typeof entrada.reason !== 'string' || entrada.reason.length === 0) {
      errores.push(`${donde}.reason está vacío`);
    }
    if (!esFechaISO(entrada.reviewBy)) errores.push(`${donde}.reviewBy no es una fecha ISO válida`);
  }

  return errores;
}

const erroresAllowlist = validarAllowlist();
if (erroresAllowlist.length > 0) {
  console.error('✗ ALLOWLIST mal formada. El gate falla cerrado:');
  for (const error of erroresAllowlist) console.error(`  - ${error}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const permitidos = new Set(['--omit=dev']);
const desconocidos = args.filter((arg) => !permitidos.has(arg));
if (desconocidos.length > 0) {
  console.error(`✗ Argumentos no soportados: ${desconocidos.join(', ')}`);
  console.error('  Solo se admite --omit=dev, igual que `npm audit`.');
  process.exit(1);
}

const resultado = spawnSync('npm', ['audit', '--json', ...args], {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
});

if (resultado.error) {
  console.error(`✗ No se pudo ejecutar npm audit: ${resultado.error.message}`);
  process.exit(1);
}
if (resultado.signal) {
  console.error(`✗ npm audit terminó por señal ${resultado.signal}. No se interpreta como verde.`);
  process.exit(1);
}

let informe;
try {
  informe = JSON.parse(resultado.stdout);
} catch {
  console.error('✗ npm audit no devolvió JSON. Salida:');
  console.error((resultado.stderr || resultado.stdout || '').slice(0, 2000));
  process.exit(1);
}

if (informe.error) {
  console.error(`✗ npm audit falló: ${informe.error.summary ?? informe.error.code ?? 'error'}`);
  console.error((informe.error.detail ?? '').slice(0, 2000));
  process.exit(1);
}
if (
  !informe.vulnerabilities ||
  typeof informe.vulnerabilities !== 'object' ||
  Array.isArray(informe.vulnerabilities)
) {
  console.error('✗ npm audit devolvió un informe sin `vulnerabilities`. No se interpreta como verde.');
  process.exit(1);
}
for (const [nombre, vulnerabilidad] of Object.entries(informe.vulnerabilities)) {
  if (
    !vulnerabilidad ||
    typeof vulnerabilidad !== 'object' ||
    Array.isArray(vulnerabilidad) ||
    !SEVERIDADES.has(vulnerabilidad.severity)
  ) {
    console.error(`✗ Entrada inválida en npm audit para ${nombre}. No se interpreta como verde.`);
    process.exit(1);
  }
}

const hoy = new Date().toISOString().slice(0, 10);
const caducadas = ALLOWLIST.filter((entrada) => entrada.reviewBy < hoy);
if (caducadas.length > 0) {
  console.error('✗ Allowlist caducada. Revisa si ya hay versión corregida:');
  for (const entrada of caducadas) {
    console.error(`  - ${entrada.package} ${entrada.ghsa} (revisar antes de ${entrada.reviewBy})`);
  }
  console.error('');
  console.error('  Si el advisory sigue sin parche, mueve la fecha y explica por qué.');
  console.error('  Si ya hay parche, quita la entrada y actualiza la dependencia.');
  process.exit(1);
}

const permitidosPorId = new Map(ALLOWLIST.map((entrada) => [entrada.ghsa, entrada]));
const vulnerabilidades = informe.vulnerabilities;
const vistos = new Map();
const bloqueantes = [];
const desajustes = [];

const declaradas = informe.metadata?.vulnerabilities;
if (
  !declaradas ||
  typeof declaradas !== 'object' ||
  Array.isArray(declaradas) ||
  !Number.isInteger(declaradas.high) ||
  !Number.isInteger(declaradas.critical)
) {
  console.error('✗ npm audit no trae `metadata.vulnerabilities` válido. No se interpreta como verde.');
  process.exit(1);
}
const declaradasAltas = declaradas.high + declaradas.critical;
const detectadasAltas = Object.values(vulnerabilidades).filter(
  (vulnerabilidad) => vulnerabilidad.severity === 'high' || vulnerabilidad.severity === 'critical'
).length;
if (declaradasAltas !== detectadasAltas) {
  console.error(
    `✗ npm audit declara ${declaradasAltas} paquetes high/critical pero solo se recorrieron ` +
      `${detectadasAltas}. Informe inconsistente: no se interpreta como verde.`
  );
  process.exit(1);
}

/** Saca el GHSA de la URL del advisory. */
function idDeAdvisory(advisory) {
  const coincidencia = /GHSA-[a-z0-9-]+/i.exec(advisory.url ?? '');
  return coincidencia ? coincidencia[0] : null;
}

/**
 * Recorre `via` hasta las advisories raíz. Una vulnerabilidad meta (`expo`,
 * `@expo/cli`) solo es aceptable si TODAS sus advisories de origen lo son.
 */
function revisar(nombre, pila) {
  if (pila.has(nombre)) return false;
  const vulnerabilidad = vulnerabilidades[nombre];
  if (!vulnerabilidad) return false;

  const siguientePila = new Set(pila).add(nombre);
  const vias = Array.isArray(vulnerabilidad.via) ? vulnerabilidad.via : [];
  let aceptada = vias.length > 0;

  for (const via of vias) {
    if (typeof via === 'string') {
      if (!revisar(via, siguientePila)) aceptada = false;
      continue;
    }
    if (!via || typeof via !== 'object' || Array.isArray(via)) {
      aceptada = false;
      continue;
    }

    const id = idDeAdvisory(via);
    if (!id) {
      aceptada = false;
      continue;
    }
    const severidad = via.severity ?? vulnerabilidad.severity;
    const paquete = via.name ?? nombre;
    if (!vistos.has(id)) {
      vistos.set(id, { id, paquete, severidad, titulo: via.title ?? '' });
    }

    const permitida = permitidosPorId.get(id);
    if (!permitida) {
      aceptada = false;
      continue;
    }
    if (paquete !== permitida.package) {
      desajustes.push(`${id} aparece en ${paquete}, no en ${permitida.package}`);
      aceptada = false;
    }
    if (severidad !== permitida.severity) {
      desajustes.push(`${id} es ${severidad}, pero la allowlist dice ${permitida.severity}`);
      aceptada = false;
    }
  }

  return aceptada;
}

for (const [nombre, vulnerabilidad] of Object.entries(vulnerabilidades)) {
  if (vulnerabilidad.severity !== 'high' && vulnerabilidad.severity !== 'critical') continue;
  if (!revisar(nombre, new Set())) {
    bloqueantes.push(nombre);
  }
}

const fueraDeLista = [...vistos.values()].filter((entrada) => !permitidosPorId.has(entrada.id));

if (bloqueantes.length > 0 || fueraDeLista.length > 0 || desajustes.length > 0) {
  console.error('✗ npm audit tiene advisories high/critical fuera de la allowlist:');
  for (const entrada of fueraDeLista) {
    console.error(`  - ${entrada.paquete} ${entrada.id} (${entrada.severidad}): ${entrada.titulo}`);
  }
  for (const desajuste of desajustes) {
    console.error(`  - ${desajuste}`);
  }
  if (fueraDeLista.length === 0 && desajustes.length === 0) {
    console.error(`  - Paquetes afectados: ${[...new Set(bloqueantes)].join(', ')}`);
  }
  console.error('');
  console.error('  Arregla la dependencia o añade la advisory a ALLOWLIST con motivo y fecha.');
  process.exit(1);
}

const aceptadas = [...vistos.values()].filter((entrada) => permitidosPorId.has(entrada.id));
if (aceptadas.length === 0) {
  console.log(`  ✓ npm audit ${args.join(' ') || '(árbol completo)'} sin advisories high/critical`);
} else {
  console.log(
    `  ✓ npm audit ${args.join(' ') || '(árbol completo)'}: solo ${aceptadas
      .map((entrada) => `${entrada.paquete} ${entrada.id}`)
      .join(', ')}`
  );
}
