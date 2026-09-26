/**
 * El enganche del evento de instalación tiene que estar en el layout raíz.
 *
 * Este test existe por una razón concreta: sin él, se puede borrar el enganche
 * del módulo, o borrar el `attach()` del layout, y la suite entera sigue en
 * verde. Son dos líneas que no se ven ni de lejos en una revisión, porque
 * los tests del almacén se limitaban a imitar el enganche en vez de
 * comprobarlo.
 *
 * El fallo que se evita es real y silencioso: `beforeinstallprompt` se lanza una
 * vez por carga. Si nadie está escuchando cuando ocurre, se pierde, y la tarjeta
 * de Ajustes acaba diciendo que el navegador no puede instalar la app cuando sí
 * puede. Como Ajustes es una pestaña y a ella se llega tras el splash y el login,
 * "tarde" es lo normal.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readLayout(): string {
  // `__dirname` y no `process.cwd()`: el directorio de invocación depende de desde
  // dónde se lance el runner, y atar el test a eso lo hace fallar sin motivo.
  return readFileSync(join(__dirname, '../../src/app/_layout.tsx'), 'utf-8');
}

describe('el layout raíz engancha el evento de instalación', () => {
  it('el layout llama a attach() del almacén', () => {
    // No se importa el layout aquí porque arrastra la cadena de la pantalla de
    // splash, que necesita un módulo nativo que en el test no existe. Se comprueba
    // el contrato sobre el fuente, que es lo que importa: que el layout enganche.
    const fuente = readLayout();

    expect(fuente).toMatch(/import\s*\{[^}]*attach[^}]*\}\s*from\s*'@\/lib\/install-prompt'/);
    expect(fuente).toMatch(/^attach\(\);$/m);
  });

  it('el layout llama a attach() una sola vez', () => {
    // Dos llamadas no rompen nada porque `attach()` es idempotente, pero sí
    // esconden que el enganche depende de dos sitios en vez de uno. El nombre
    // anterior de este test hablaba del import, que es lo que comprueba el otro.
    const fuente = readLayout();
    // Anclado a línea completa: sin el ancla, un `attach();` escrito en un
    // comentario haria fallar CI sin que cambiara una línea de código.
    const llamadas = fuente.match(/^attach\(\);$/gm) ?? [];
    expect(llamadas).toHaveLength(1);
  });
});
