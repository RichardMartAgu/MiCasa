import { attach, consume, read, resetForTests, subscriberCountForTests, subscribe } from '@/lib/install-prompt';

/**
 * El almacén del evento de instalación, por separado del hook.
 *
 * Aquí se prueba lo que el hook no puede: que el evento sobreviva a que nadie
 * esté mirando. En la app real, entre que el navegador lanza
 * `beforeinstallprompt` y que la persona abre Ajustes pasa el splash, el login y
 * elegir casa, así que el caso de que no haya ningún componente montado no es un
 * invento del test: es el estado normal durante casi toda la sesión.
 */
function stubBrowser() {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const win = {
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      const set = listeners.get(type) ?? new Set();
      set.add(fn);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners.get(type)?.delete(fn);
    },
  };
  Object.defineProperty(global, 'window', { configurable: true, value: win });
  return {
    emit: (type: string, event: unknown) => {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
    count: (type: string) => listeners.get(type)?.size ?? 0,
  };
}

function evento() {
  return {
    preventDefault: jest.fn(),
    prompt: jest.fn(async () => undefined),
    userChoice: Promise.resolve({ outcome: 'accepted' }),
  };
}

describe('install-prompt: el evento no se pierde aunque nadie lo pida', () => {
  beforeEach(() => {
    resetForTests();
  });

  it('engancha el listener al IMPORTAR el módulo, sin llamar a attach() a mano', () => {
    // Esta es la garantía de fondo del bloque, y por eso el test no llama a
    // `attach()`: si lo hiciera, estaría imitando lo que quiere comprobar.
    // `isolateModules` da una instancia nueva del módulo, como la que se
    // evalúa cuando la app arranca.
    const browser = stubBrowser();

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@/lib/install-prompt');
    });

    expect(browser.count('beforeinstallprompt')).toBe(1);
  });

  it('importarlo dos veces no duplica el listener', () => {
    // Un `prompt()` sobre un evento con dos listeners registrados se consume en el
    // sitio equivocado, y el botón dejaría de funcionar sin decir por qué.
    const browser = stubBrowser();

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@/lib/install-prompt');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@/lib/install-prompt');
    });

    expect(browser.count('beforeinstallprompt')).toBe(1);
  });

  it('llamar a attach() a mano no duplica el listener', () => {
    // El layout raíz lo llama además de la importación. Es idempotente a
    // propósito, y esto lo ata.
    const browser = stubBrowser();
    attach();
    attach();
    attach();

    expect(browser.count('beforeinstallprompt')).toBe(1);
  });

  it('guarda el evento aunque no haya ningún suscriptor', () => {
    const browser = stubBrowser();
    attach();
    const pendiente = evento();

    browser.emit('beforeinstallprompt', pendiente);

    expect(read()).toBe(pendiente);
  });

  it('llama a preventDefault aunque no haya nadie escuchando', () => {
    // Sin esto, el navegador se lleva el caso con su banner y el evento no
    // vuelve. Que no haya suscriptores es justo el caso que hay que cubrir.
    const browser = stubBrowser();
    attach();
    const pendiente = evento();

    browser.emit('beforeinstallprompt', pendiente);

    expect(pendiente.preventDefault).toHaveBeenCalled();
  });

  it('avisa a los suscriptores que haya, y a los que vengan después', () => {
    const browser = stubBrowser();
    const primero = jest.fn();
    subscribe(primero);
    const pendiente = evento();

    browser.emit('beforeinstallprompt', pendiente);
    expect(primero).toHaveBeenCalledTimes(1);

    // Uno que se suscribe después recibe el estado por `read`, no por aviso.
    expect(read()).toBe(pendiente);
  });

  it('consume() vacía el evento y avisa', () => {
    const browser = stubBrowser();
    const oyente = jest.fn();
    subscribe(oyente);
    browser.emit('beforeinstallprompt', evento());

    consume();

    expect(read()).toBeNull();
    expect(oyente).toHaveBeenCalledTimes(2);
  });

  it('poner el mismo evento dos veces no avisa dos veces', () => {
    // `useSyncExternalStore` compara por identidad. Si el valor no cambia, que no
    // se avise es lo correcto: React descarta el render y no se repinta nada.
    const browser = stubBrowser();
    const oyente = jest.fn();
    subscribe(oyente);
    browser.emit('beforeinstallprompt', evento());
    expect(oyente).toHaveBeenCalledTimes(1);

    consume();
    consume();

    expect(oyente).toHaveBeenCalledTimes(2);
  });

  it('soltar la suscripción la quita, y el resto sigue funcionando', () => {
    const browser = stubBrowser();
    const oyente = jest.fn();
    const soltar = subscribe(oyente);
    browser.emit('beforeinstallprompt', evento());
    oyente.mockClear();

    soltar();
    expect(subscriberCountForTests()).toBe(0);
    browser.emit('beforeinstallprompt', evento());

    expect(oyente).not.toHaveBeenCalled();
  });

  it('solo engancha un listener aunque se suscriba muchas veces', () => {
    const browser = stubBrowser();
    subscribe(() => undefined);
    subscribe(() => undefined);
    subscribe(() => undefined);

    expect(browser.count('beforeinstallprompt')).toBe(1);
  });

  it('sin un window que admita listeners, no se rompe', () => {
    // React Native define un `window` que no es un DOM window, y el layout raíz
    // importa este módulo en nativo. Un enganche a ciegas aquí tumbaría la app
    // al arrancar, no solo una pantalla opcional.
    Object.defineProperty(global, 'window', { configurable: true, value: {} });

    expect(() => subscribe(() => undefined)).not.toThrow();
    expect(read()).toBeNull();
  });
});
