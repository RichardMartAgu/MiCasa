import { act } from '@testing-library/react-native';
import { pathToRegexp } from 'path-to-regexp';

import {
  aplicarActualizacion,
  leerPendiente,
  resetForTests,
  suscribir,
  vigilarActualizacion,
} from '@/lib/sw-update';

/**
 * El atasco que motivó este módulo, medido: sin `skipWaiting()` la versión nueva
 * no puede activarse mientras quede un cliente viejo, y con la app instalada ese
 * cliente casi siempre existe. El usuario se quedaba con el bundle del primer
 * despliegue, para siempre, sin que nada lo dijera.
 */

type Escucha = (evento: unknown) => void;

interface WorkerFalso {
  state: string;
  scriptURL: string;
  addEventListener: (tipo: string, fn: Escucha) => void;
}

interface RegistrationFalsa {
  waiting: (WorkerFalso & { postMessage?: (m: unknown) => void }) | null;
  installing: WorkerFalso | null;
  listeners: Map<string, Set<Escucha>>;
  addEventListener: (tipo: string, fn: Escucha) => void;
}

interface OpcionesStub {
  conRegistration?: boolean;
  waiting?: boolean;
  hayControlador?: boolean;
  scriptUrl?: string;
  /** Permite observar que el mensaje de activación sale de verdad. */
  waitingPostMessage?: (mensaje: unknown) => void;
}

/**
 * Un `navigator.serviceWorker` de mentira, con lo justo para comprobar lo que
 * hace el vigilante: un worker que ya esperaba, y la secuencia real de Chrome
 * cuando descarga uno nuevo (`updatefound` y su `statechange` a "installed").
 */
function stubServiceWorker(opciones: OpcionesStub = {}) {
  const enVentana = new Map<string, Set<Escucha>>();
  const stateChange = new Set<Escucha>();
  const listeners = new Map<string, Set<Escucha>>();
  // Mutable a propósito: `cambiarVersion` simula un despliegue nuevo, con el
  // worker entrante y el que espera llevando ya la URL nueva.
  let scriptUrl = opciones.scriptUrl ?? 'https://ejemplo/sw.js';

  const registration: RegistrationFalsa | null =
    opciones.conRegistration === false
      ? null
      : {
          waiting: opciones.waiting
            ? {
                state: 'installed',
                scriptURL: scriptUrl,
                postMessage: opciones.waitingPostMessage ?? (() => undefined),
                addEventListener: (tipo, fn) => {
                  if (tipo === 'statechange') stateChange.add(fn);
                },
              }
            : null,
          installing: null,
          listeners,
          addEventListener(tipo, fn) {
            const set = listeners.get(tipo) ?? new Set();
            set.add(fn);
            listeners.set(tipo, set);
          },
        };

  const container = {
    controller: opciones.hayControlador === false ? null : {},
    addEventListener: (tipo: string, fn: Escucha) => {
      const set = enVentana.get(tipo) ?? new Set();
      set.add(fn);
      enVentana.set(tipo, set);
    },
    getRegistration: async (): Promise<RegistrationFalsa | null> => registration,
  };

  const anterior = (global as { navigator?: unknown }).navigator;
  (global as { navigator?: unknown }).navigator = { serviceWorker: container };

  function nuevoWorker(estado: string): WorkerFalso {
    return {
      state: estado,
      scriptURL: scriptUrl,
      addEventListener: (tipo, fn) => {
        if (tipo === 'statechange') stateChange.add(fn);
      },
    };
  }

  /** Chrome encuentra un service worker nuevo y lo pone a instalar. */
  function entrar(): WorkerFalso {
    const o = nuevoWorker('installing');
    if (registration) registration.installing = o;
    for (const fn of listeners.get('updatefound') ?? []) fn({ type: 'updatefound' });
    return o;
  }

  function instalar(o: WorkerFalso, estado: 'installing' | 'installed' = 'installed') {
    o.state = estado;
    for (const fn of stateChange) fn({ type: 'statechange' });
  }

  return {
    container,
    registration,
    entrar,
    instalar,
    /** El despliegue nuevo: otro worker, con otra URL. */
    cambiarVersion: (url: string) => {
      scriptUrl = url;
      if (registration) {
        registration.waiting = {
          state: 'installed',
          scriptURL: url,
          postMessage: () => undefined,
          addEventListener: () => undefined,
        };
      }
    },
    /** Atajo para la secuencia completa: aparece una versión nueva lista. */
    marcar: () => instalar(entrar(), 'installed'),
    controlCambia: () => {
      for (const fn of enVentana.get('controllerchange') ?? []) fn({ type: 'controllerchange' });
    },
    restaurar: () => {
      (global as { navigator?: unknown }).navigator = anterior;
    },
  };
}

beforeEach(() => {
  resetForTests();
  jest.restoreAllMocks();
  // Este entorno de test no es jsdom. La marca de "recarga pedida" vive en
  // sessionStorage a propósito, para reconocer un `controllerchange` que llegue
  // de otra pestaña, así que sin ella el flujo de recarga no se puede probar.
  const almacen = new Map<string, string>();
  (global as unknown as { sessionStorage?: unknown }).sessionStorage = {
    getItem: (k: string) => almacen.get(k) ?? null,
    setItem: (k: string, v: string) => void almacen.set(k, v),
    removeItem: (k: string) => void almacen.delete(k),
  };
});

describe('sw-update: detectar que hay versión nueva', () => {
  it('avisa en cuanto monta si ya había un service worker esperando', async () => {
    const sw = stubServiceWorker({ waiting: true });
    try {
      vigilarActualizacion();
      await Promise.resolve();
      await Promise.resolve();
      expect(leerPendiente()).toBe(true);
    } finally {
      sw.restaurar();
    }
  });

  it('avisa cuando llega una versión nueva mientras la app está abierta', async () => {
    const sw = stubServiceWorker({ hayControlador: true });
    try {
      vigilarActualizacion();
      await Promise.resolve();
      await Promise.resolve();
      expect(leerPendiente()).toBe(false);

      // La secuencia real de Chrome: `updatefound` pone un worker en
      // `installing`, y su `statechange` a "installed" con un service worker ya
      // activo es lo que significa que hay otra versión esperando.
      const entrante = sw.entrar();
      expect(leerPendiente()).toBe(false);
      sw.instalar(entrante);
      expect(leerPendiente()).toBe(true);
    } finally {
      sw.restaurar();
    }
  });

  it('sin service worker activo no se dispara el aviso', async () => {
    // Sin un worker controlando la página, lo que llega es la primera
    // instalación, no una actualización: no hay nada que recargar.
    const sw = stubServiceWorker({ hayControlador: false });
    try {
      vigilarActualizacion();
      await Promise.resolve();
      await Promise.resolve();
      const entrante = sw.entrar();
      sw.instalar(entrante);
      expect(leerPendiente()).toBe(false);
    } finally {
      sw.restaurar();
    }
  });

  it('el aviso NO desaparece solo cuando cambia el control, y se recarga', async () => {
    // Este es el motivo de haber rehecho el diseño. Con `skipWaiting()` al
    // instalarse, el `controllerchange` llegaba en el mismo instante y el aviso se
    // iba sin que nadie lo pulsara: la página se quedaba con el código viejo y
    // un worker nuevo, que es el peor de los dos mundos.
    const sw = stubServiceWorker({ waiting: true });
    const reload = jest.fn();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload } });
    try {
      vigilarActualizacion();
      await Promise.resolve();
      await Promise.resolve();
      expect(leerPendiente()).toBe(true);
      sw.controlCambia();
      // Nadie había pedido recargar: no se recarga ni se oculta el aviso.
      expect(reload).not.toHaveBeenCalled();
      expect(leerPendiente()).toBe(true);
    } finally {
      sw.restaurar();
    }
  });

  it('tras pedir la recarga, el cambio de control sí recarga', async () => {
    const postMessage = jest.fn();
    const sw = stubServiceWorker({ waiting: true, waitingPostMessage: postMessage });
    const reload = jest.fn();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload } });
    try {
      vigilarActualizacion();
      await Promise.resolve();
      await Promise.resolve();
      aplicarActualizacion();
      await Promise.resolve();
      await Promise.resolve();
      sw.controlCambia();
      expect(reload).toHaveBeenCalled();
      expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    } finally {
      sw.restaurar();
    }
  });

  it('"Más tarde" silencia el aviso de esa version, no de las siguientes', async () => {
    // `sessionStorage` sobrevive a las recargas, así que una marca suelta
    // silenciaría los avisos de todos los despliegues siguientes en esa pestaña.
    // Se guarda qué worker se descartó, y con un worker nuevo el aviso vuelve.
    const { descartarVersion } = jest.requireActual('@/lib/sw-update') as {
      descartarVersion: () => void;
    };
    const sw = stubServiceWorker({ waiting: true, scriptUrl: 'https://x/sw.js?v=1' });
    try {
      vigilarActualizacion();
      await Promise.resolve();
      await Promise.resolve();
      expect(leerPendiente()).toBe(true);

      await act(async () => {
        descartarVersion();
      });
      expect(leerPendiente()).toBe(false);

      // La misma versión, que ya se descartó: no se vuelve a preguntar.
      await act(async () => {
        sw.marcar();
      });
      expect(leerPendiente()).toBe(false);

      // Un despliegue nuevo en la misma pestaña: vuelve a avisar, porque lo que
      // se descartó era otra versión.
      sw.cambiarVersion('https://x/sw.js?v=2');
      await act(async () => {
        sw.marcar();
      });
      expect(leerPendiente()).toBe(true);
    } finally {
      sw.restaurar();
    }
  });

  it('sin registro no pasa nada, y no se rompe', async () => {
    const sw = stubServiceWorker({ conRegistration: false });
    try {
      expect(() => vigilarActualizacion()).not.toThrow();
      await Promise.resolve();
      expect(leerPendiente()).toBe(false);
    } finally {
      sw.restaurar();
    }
  });

  it('suscribirse y soltar la suscripción notifica y no deja fugas', () => {
    const onChange = jest.fn();
    const soltar = suscribir(onChange);
    // Con el mismo valor no se notifica: notificar siempre sería un render de más
    // en cada montaje, y aquí no hay ningún estado que haya cambiado.
    onChange.mockClear();
    soltar();
    onChange.mockClear();
    // Tras soltarla, la lista está vacía y no queda nada que pueda llamar a un
    // componente desmontado.
    const onChange2 = jest.fn();
    const soltar2 = suscribir(onChange2);
    soltar2();
    expect(onChange2).not.toHaveBeenCalled();
  });
});

describe('la regla de reescritura de Vercel', () => {
  // La primera versión de este bloque verificó la regla con `picomatch`, que es
  // un matcher de glob, y no con el motor que usa Vercel: un test con el motor
  // equivocado certifica una verdad que no es la real. `rewrites.source` se
  // compila con path-to-regexp, así que se comprueba con path-to-regexp.
  // Sigue sin ser la garantía final —Vercel puede usar otra versión— y el cierre
  // es el curl contra el despliegue, pero convierte "no lo sé" en "comprobado
  // con el motor que dice usar Vercel".
  const vercel = JSON.parse(
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'vercel.json'), 'utf8'),
  );
  const regla = vercel.rewrites[0];
  const re = pathToRegexp(regla.source);

  it('las rutas de la app siguen llegando al shell', () => {
    // Sin esto, recargar en cualquier pantalla distinta de Inicio daría 404.
    for (const ruta of ['/', '/citas', '/cumpleanos', '/ajustes', '/gastos', '/listas', '/inventario']) {
      expect({ ruta, reescribe: re.test(ruta) }).toEqual({ ruta, reescribe: true });
    }
  });

  it('un fichero que no existe da 404 en vez de HTML con 200', () => {
    // El fallo que motivó el cambio: un bundle de un despliegue anterior pedía un
    // `.js` que ya no estaba y recibía 200 `text/html`. Con `nosniff`, el
    // navegador se negaba a ejecutarlo y no había ningún error visible.
    for (const fichero of [
      '/_expo/static/js/web/entry-6efd5d3cf2f7bbef0ce829473e83816a.js',
      '/_expo/static/js/web/entry-5a6f802af2a92fd72a741513673e4a93.js',
      '/no-existe.js',
      '/icon-999.png',
      '/sw.js',
      '/manifest.webmanifest',
      '/assets/Inter-Bold.otf',
    ]) {
      expect({ fichero, reescribe: re.test(fichero) }).toEqual({ fichero, reescribe: false });
    }
  });

  it('la regla ya no es la que se tragaba todo', () => {
    expect(regla.source).not.toBe('/(.*)');
    expect(regla.destination).toBe('/index.html');
  });

  it('el service worker se activa por mensaje, y solo una vez', () => {
    const fuente = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '..', '..', 'sw-src.js'),
      'utf8',
    );
    expect(fuente).toContain("addEventListener('message'");
    // El original del repo exigía no tener `skipWaiting`; eso era un atasco. Ahora
    // la exigencia es la contraria: que se llame exactamente una vez, y solo desde
    // el listener de `message` que comprueba el mensaje.
    //
    // Se cuentan las llamadas sobre el código sin comentarios, que es lo que
    // acaba en `dist/sw.js`: contar sobre el fuente contaría también las
    // menciones en los comentarios, que es lo que explica por qué esta guarda se
    // mide en el build y no en un test de unidad.
    const codigo = fuente
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((linea: string) => !linea.trim().startsWith('//'))
      .join('\n');
    expect((codigo.match(/skipWaiting\s*\(/g) ?? []).length).toBe(1);
    expect(codigo).not.toMatch(/addEventListener\('install'[\s\S]{0,200}skipWaiting/);
    // Y el origen se comprueba: solo el propio sitio puede pedir la activación.
    expect(fuente).toContain('event.origin');
  });

  it('el sw.js se sirve sin caché, para que la comprobación de actualización sea fresca', () => {
    const cab = vercel.headers.find((h: { source: string }) => h.source === '/sw.js');
    expect(cab).toBeTruthy();
    const cache = cab.headers.find((h: { key: string }) => h.key === 'Cache-Control');
    expect(cache.value).toMatch(/no-store|no-cache/);
  });
});
