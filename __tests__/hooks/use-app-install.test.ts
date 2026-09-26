import { act, renderHook } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { useAppInstall } from '@/hooks/use-app-install';
import { attach, resetForTests, subscriberCountForTests } from '@/lib/install-prompt';

const UA_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const UA_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

/**
 * Instala un `window` con lo justo para poder emitir los eventos del navegador.
 *
 * El entorno de pruebas de React Native define un `window` que no es un DOM
 * window, y el hook lo comprueba antes de escuchar. Estos stubs lo reproducen de
 * verdad para poder probar el recorrido entero, no solo la lógica pura.
 */
function stubBrowser(options: { standalone?: boolean; matchMedia?: boolean } = {}) {
  let standalone = options.standalone ?? false;
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const displayModeListeners = new Set<() => void>();

  const win = {
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      const set = listeners.get(type) ?? new Set();
      set.add(fn);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners.get(type)?.delete(fn);
    },
    matchMedia:
      options.matchMedia === false
        ? undefined
        : (query: string) => {
            if (!query.includes('standalone')) {
              return {
                matches: false,
                addEventListener: () => undefined,
                removeEventListener: () => undefined,
              };
            }
            return {
              get matches() {
                return standalone;
              },
              addEventListener: (_t: string, fn: () => void) => {
                displayModeListeners.add(fn);
              },
              removeEventListener: (_t: string, fn: () => void) => {
                displayModeListeners.delete(fn);
              },
            };
          },
    PushManager: function PushManager() {},
    Notification: function Notification() {},
  };

  Object.defineProperty(global, 'window', { configurable: true, value: win });
  // `serviceWorker` va por defecto porque en un navegador real siempre esta,
  // y el aviso de push lo necesita para decidir si tiene sentido pedir instalar.
  Object.defineProperty(global, 'navigator', {
    configurable: true,
    value: { userAgent: UA_ANDROID, vendor: 'Google Inc.', serviceWorker: {} },
  });

  return {
    win,
    emit: (type: string, event: unknown) => {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
    /** Cuantos eventos de este tipo quedan registrados. */
    count: (type: string) => listeners.get(type)?.size ?? 0,
    /** Dispara el `change` de `display-mode`, como hace el navegador real. */
    fireDisplayMode: () => {
      for (const fn of displayModeListeners) fn();
    },
    displayModeListenerCount: () => displayModeListeners.size,
    setStandalone: (value: boolean) => {
      standalone = value;
    },
  };
}

function eventoInstallPrompt(accepted: boolean) {
  return {
    preventDefault: jest.fn(),
    prompt: jest.fn(async () => undefined),
    userChoice: Promise.resolve({ outcome: accepted ? 'accepted' : 'dismissed' }),
  };
}

describe('useAppInstall', () => {
  const originalOs = Platform.OS;

  beforeEach(() => {
    Platform.OS = 'web';
    // La caché del evento es de módulo, a propósito, para que no se pierda si
    // Ajustes monta tarde. Eso significa que sobrevive entre tests, y un test
    // que deja un evento puesto haría pasar a los siguientes por lo mismo.
    resetForTests();
  });

  afterEach(() => {
    Platform.OS = originalOs;
  });

  it('sin evento del navegador, en Android, dice que no se puede instalar', () => {
    // Chrome lanza el evento cuando puede. Si no ha llegado, no se promete un
    // boton: es mejor decir que no se puede que ofrecer un boton que no hace nada.
    stubBrowser();
    const { result } = renderHook(() => useAppInstall());

    expect(result.current.view.actionIsPrompt).toBe(false);
    expect(result.current.view.body).toContain('favoritos');
  });

  it('si el navegador lanza el evento, aparece el boton de instalar', () => {
    const browser = stubBrowser();
    const { result } = renderHook(() => useAppInstall());

    act(() => {
      browser.emit('beforeinstallprompt', eventoInstallPrompt(true));
    });

    expect(result.current.view.actionIsPrompt).toBe(true);
    expect(result.current.view.action).toBe('Instalar ahora');
  });

  it('llama a preventDefault para que el banner del navegador no se lleve el evento', () => {
    // Sin esto, Chrome enseña su propio banner y el evento se consume. Cuando la
    // persona lo cierra desde ahi, el botón de la app ya no funciona para
    // siempre. El botón propio tiene que poder instalar, no solo tapar el banner.
    const browser = stubBrowser();
    const { result } = renderHook(() => useAppInstall());
    const evento = eventoInstallPrompt(true);

    act(() => {
      browser.emit('beforeinstallprompt', evento);
    });

    expect(evento.preventDefault).toHaveBeenCalled();
    expect(result.current.view.actionIsPrompt).toBe(true);
  });

  it('instalar llama a prompt y acepta', async () => {
    const browser = stubBrowser();
    const { result } = renderHook(() => useAppInstall());
    const evento = eventoInstallPrompt(true);
    act(() => {
      browser.emit('beforeinstallprompt', evento);
    });

    let aceptado: boolean | undefined;
    await act(async () => {
      aceptado = await result.current.install();
    });

    expect(evento.prompt).toHaveBeenCalled();
    expect(aceptado).toBe(true);
  });

  it('tras instalar, deja de ofrecer instalar y da la por instalada', async () => {
    // El evento se agota en cuanto se usa: si se volviera a oferecer, el boton
    // fallaria en silencio la segunda vez.
    const browser = stubBrowser();
    const { result } = renderHook(() => useAppInstall());
    act(() => {
      browser.emit('beforeinstallprompt', eventoInstallPrompt(true));
    });

    await act(async () => {
      await result.current.install();
    });

    expect(result.current.standalone).toBe(true);
    expect(result.current.view.action).toBeNull();
    expect(result.current.view.title).toBe('App instalada');
  });

  it('si la persona rechaza, el boton desaparece: el evento ya se gastó', async () => {
    const browser = stubBrowser();
    const { result } = renderHook(() => useAppInstall());
    act(() => {
      browser.emit('beforeinstallprompt', eventoInstallPrompt(false));
    });

    let aceptado: boolean | undefined;
    await act(async () => {
      aceptado = await result.current.install();
    });

    expect(aceptado).toBe(false);
    expect(result.current.view.action).toBeNull();
    // Rechazar NO es instalar. Sin esto, la tarjeta podría darle por instalada a
    // quien acaba de decir que no, que es la mentira más visible posible aquí.
    expect(result.current.standalone).toBe(false);
    expect(result.current.view.title).not.toBe('App instalada');
  });

  it('un prompt que lanza no tumba la pantalla, y el boton se retira', async () => {
    // Un `prompt()` que revienta significa que el navegador ya no lo permite.
    // Quitar el boton y seguir es mejor que dejarlo para que lo pulsen otra vez.
    const browser = stubBrowser();
    const { result } = renderHook(() => useAppInstall());
    act(() => {
      browser.emit('beforeinstallprompt', {
        preventDefault: jest.fn(),
        prompt: jest.fn(async () => {
          throw new Error('no permitido');
        }),
        userChoice: Promise.resolve({ outcome: 'dismissed' }),
      });
    });

    let aceptado: boolean | undefined;
    await act(async () => {
      aceptado = await result.current.install();
    });

    expect(aceptado).toBe(false);
    expect(result.current.view.action).toBeNull();
  });

  it('instalar sin evento no hace nada y no lanza', async () => {
    // El botón solo se pinta con evento, pero la función tiene que ser segura
    // igual: si no, un toque en un renders desfasado revienta la pantalla.
    stubBrowser();
    const { result } = renderHook(() => useAppInstall());

    let aceptado: boolean | undefined;
    await act(async () => {
      aceptado = await result.current.install();
    });

    expect(aceptado).toBe(false);
  });

  it('instalada desde el menú del navegador, la tarjeta lo dice y no ofrece instalar', () => {
    // Se puede instalar desde el menú del navegador sin pasar por el botón, y al
    // volver a una pestaña normal la app sigue abierta. Por eso se mira el modo
    // de visualización y no solo el evento.
    stubBrowser({ standalone: true });
    const { result } = renderHook(() => useAppInstall());

    expect(result.current.standalone).toBe(true);
    expect(result.current.view.title).toBe('App instalada');
    expect(result.current.view.action).toBeNull();
  });

  it('en iPhone da los pasos de Compartir, porque no hay evento que capturar', () => {
    stubBrowser();
    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: { userAgent: UA_IPHONE, vendor: 'Apple Computer, Inc.', serviceWorker: {} },
    });
    const { result } = renderHook(() => useAppInstall());

    expect(result.current.platform).toBe('ios');
    expect(result.current.view.action).toBeNull();
    expect(result.current.view.steps.join(' ')).toContain('Compartir');
  });

  it('en iPhone avisa de que los avisos necesitan la app instalada', async () => {
    // Es el motivo real de pedir instalar en iPhone: el push funciona en la app
    // de la pantalla de inicio y no en una pestaña normal.
    stubBrowser();
    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: { userAgent: UA_IPHONE, vendor: 'Apple Computer, Inc.', serviceWorker: {} },
    });
    const { result } = renderHook(() => useAppInstall());
    // El soporte de push se mide en un efecto aparte del resto, asi que su
    // actualizacion llega en un segundo render.
    await act(async () => {});

    expect(result.current.pushNotice).not.toBeNull();
    expect(result.current.pushNotice?.body).toContain('Compartir');
  });

  it('en iPhone, ya instalada, no avisa de nada', () => {
    stubBrowser({ standalone: true });
    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: { userAgent: UA_IPHONE, vendor: 'Apple Computer, Inc.', serviceWorker: {} },
    });
    const { result } = renderHook(() => useAppInstall());

    expect(result.current.pushNotice).toBeNull();
  });

  it('en Android no avisa de que falte instalar', () => {
    // En el resto de plataformas el push va sin instalar: pedirlo sería molestar
    // sin motivo.
    stubBrowser();
    const { result } = renderHook(() => useAppInstall());

    expect(result.current.pushNotice).toBeNull();
  });

  it('si no hay soporte de push, no pide instalar', async () => {
    // Sin push no hay nada que pedir a cambio. Antes esto se confundía y salía
    // el aviso de instalar en navegadores que no podían enviar nada.
    stubBrowser();
    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: { userAgent: UA_IPHONE, vendor: 'Apple Computer, Inc.', serviceWorker: {} },
    });
    delete (global.window as { PushManager?: unknown }).PushManager;
    const { result } = renderHook(() => useAppInstall());
    await act(async () => {});

    expect(result.current.pushNotice).toBeNull();
  });

  it('en nativo no enseña la tarjeta y no toca el navegador', () => {
    Platform.OS = 'ios';
    const browser = stubBrowser();
    const { result } = renderHook(() => useAppInstall());

    expect(result.current.view.visible).toBe(false);
    expect(browser.count('beforeinstallprompt')).toBe(0);
  });

  it('si el window no permite escuchar, no se rompe al montar', () => {
    // React Native define un `window` que no es un DOM window. Si el hook
    // escucha a ciegas, Ajustes no monta, y es la parte opcional de la pantalla
    // la que tumba el resto.
    Platform.OS = 'web';
    Object.defineProperty(global, 'window', { configurable: true, value: {} });
    Object.defineProperty(global, 'navigator', {
      configurable: true,
      // `serviceWorker` va por defecto porque en un navegador real siempre esta,
      // y el aviso de push lo necesita para decidir si tiene sentido pedir instalar.
      value: { userAgent: UA_ANDROID, vendor: 'Google Inc.', serviceWorker: {} },
    });

    expect(() => renderHook(() => useAppInstall())).not.toThrow();
  });

  it('si existe window pero no navigator, no se rompe y no se instala', () => {
    // Es el escenario que tumbó la pantalla de Ajustes al montar esto por
    // primera vez: `window` existe y `navigator` no. React Native monta uno de
    // esos, y un webview embebido puede montar el otro.
    Platform.OS = 'web';
    Object.defineProperty(global, 'window', {
      configurable: true,
      value: { addEventListener: () => undefined, removeEventListener: () => undefined },
    });
    Reflect.deleteProperty(global as object, 'navigator');

    const { result } = renderHook(() => useAppInstall());

    expect(result.current.standalone).toBe(false);
    expect(result.current.platform).toBe('otro');
    expect(result.current.view.action).toBeNull();
  });

  it('si no hay window pero si navigator, tampoco se rompe', () => {
    // El caso espejo del anterior. Si `readStandalone` leyera `window` sin
    // comprobarlo, esto sería un ReferenceError al montar, y en el layout raíz
    // importaría más: rompería la app entera, no una pantalla opcional.
    //
    // `navigator` se define a propósito: en el entorno de pruebas no existe, y sin
    // él la guarda de `navigator` cortaría antes de llegar a la de `window`, que es
    // la que este test quiere comprobar. Con las dos cosas definidas y `window`
    // ausente, solo la guarda de `window` puede salvar el render.
    Platform.OS = 'web';
    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: { userAgent: UA_ANDROID, vendor: 'Google Inc.', serviceWorker: {} },
    });
    Object.defineProperty(global, 'window', { configurable: true, value: undefined });

    const { result } = renderHook(() => useAppInstall());

    expect(result.current.standalone).toBe(false);
    expect(result.current.view.visible).toBe(true);
    expect(result.current.view.action).toBeNull();
  });

  it('si no hay matchMedia, se instala igual mirando navigator.standalone', () => {
    // Safari en iPhone no implementa `display-mode`: la forma de saber si la app
    // está instalada es `navigator.standalone`. Sin este camino, en el iPhone la
    // tarjeta diria "instala" estando ya instalada.
    stubBrowser({ matchMedia: false });
    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: { userAgent: UA_IPHONE, vendor: 'Apple Computer, Inc.', serviceWorker: {}, standalone: true },
    });
    const { result } = renderHook(() => useAppInstall());

    expect(result.current.standalone).toBe(true);
    expect(result.current.view.action).toBeNull();
  });

  it('el evento appinstalled del navegador da la app por instalada y retira el boton', () => {
    // Es lo que salta cuando la persona acepta el dialogo del propio navegador,
    // o cuando instala desde el menú. El evento se gastó, asi que el boton propio
    // ya no puede volver a ofrecerlo.
    const browser = stubBrowser();
    const { result } = renderHook(() => useAppInstall());
    act(() => {
      browser.emit('beforeinstallprompt', eventoInstallPrompt(true));
    });
    expect(result.current.view.actionIsPrompt).toBe(true);

    act(() => {
      browser.emit('appinstalled', {});
    });

    expect(result.current.standalone).toBe(true);
    expect(result.current.view.action).toBeNull();
    expect(result.current.view.title).toBe('App instalada');
  });

  it('si el evento pasa con la pantalla cerrada, no se pierde', () => {
    // Chromium lanza `beforeinstallprompt` una vez por carga y no lo repite. La
    // pantalla de Ajustes se abre cuando la persona va a esa pestaña, y el evento
    // puede haberse firmado antes. Si el listener viviera dentro del componente,
    // se perdería, no se llamaría a `preventDefault()`, y la tarjeta acabaría
    // diciendo "este navegador no puede instalarla" en un Chrome que sí puede.
    // Eso es el caso más común: el del botón que funciona.
    const browser = stubBrowser();
    // El almacén engancha al importar la app, no al montar la pantalla. Aquí se
    // representa ese momento: el listener está vivo aunque no haya nada montado.
    attach();

    // El evento ocurre con la pantalla cerrada y sin ningún componente.
    browser.emit('beforeinstallprompt', eventoInstallPrompt(true));

    const primera = renderHook(() => useAppInstall());

    expect(primera.result.current.view.actionIsPrompt).toBe(true);
    expect(primera.result.current.view.action).toBe('Instalar ahora');
  });

  it('tras cerrar y volver a abrir la pantalla, el botón sigue ahí', () => {
    // La otra mitad del mismo caso: montar, cerrar y volver a abrir no puede
    // perder el evento ni gastarlo.
    const browser = stubBrowser();
    attach();
    browser.emit('beforeinstallprompt', eventoInstallPrompt(true));

    const primera = renderHook(() => useAppInstall());
    primera.unmount();
    const segunda = renderHook(() => useAppInstall());

    expect(segunda.result.current.view.actionIsPrompt).toBe(true);
  });

  it('el evento que llega despues de montar tambien llega', () => {
    // El camino normal, que es el que ya cubrian los tests de arriba. Se queda
    // explicito para que el cambio a cache de modulo no lo haya dejado fuera.
    const browser = stubBrowser();
    const { result } = renderHook(() => useAppInstall());
    expect(result.current.view.actionIsPrompt).toBe(false);

    act(() => {
      browser.emit('beforeinstallprompt', eventoInstallPrompt(true));
    });

    expect(result.current.view.actionIsPrompt).toBe(true);
  });

  it('el evento gastado no se vuelve a ofrecer a quien monte despues', async () => {
    // Tras usarlo, el evento no vale. Sin vaciar la caché, alguien que abriera
    // Ajustes por segunda vez vería un botón que al pulsarlo no hace nada.
    const browser = stubBrowser();
    const { result, unmount } = renderHook(() => useAppInstall());
    act(() => {
      browser.emit('beforeinstallprompt', eventoInstallPrompt(true));
    });
    await act(async () => {
      await result.current.install();
    });
    unmount();

    const segundo = renderHook(() => useAppInstall());
    expect(segundo.result.current.view.action).toBeNull();
  });

  it('si llegan dos eventos, gana el último', () => {
    // Chromium lanza el evento una vez por carga, pero un `beforeinstallprompt`
    // a mano, o un segundo disparo tras recargar el service worker, pueden
    // ocurrir. Guardar el primero dejaría al botón apuntando a un evento que
    // quizá el navegador ya no lo respeta, y `prompt()` fallaría sin explicación.
    const browser = stubBrowser();
    const { result } = renderHook(() => useAppInstall());
    const primero = eventoInstallPrompt(false);
    const segundo = eventoInstallPrompt(true);

    act(() => {
      browser.emit('beforeinstallprompt', primero);
    });
    act(() => {
      browser.emit('beforeinstallprompt', segundo);
    });

    return act(async () => {
      await result.current.install();
    }).then(() => {
      expect(segundo.prompt).toHaveBeenCalled();
      expect(primero.prompt).not.toHaveBeenCalled();
    });
  });

  it('si el navegador no tiene Notification, tampoco hay soporte de push', async () => {
    // Las tres APIs hacen falta. Un navegador con service worker y PushManager pero
    // sin Notification podría suscribir y no tener dónde pintar el aviso, así que
    // pedirle que instale la app sería una instrucción que no arregla nada.
    //
    // `serviceWorker` está a propósito: si falta, el soporte de push cae por ahí y
    // este test pasa igual con o sin la comprobación de `Notification`, es decir,
    // sin comprobar lo que dice comprobar.
    stubBrowser();
    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: {
        userAgent: UA_IPHONE,
        vendor: 'Apple Computer, Inc.',
        serviceWorker: {},
        maxTouchPoints: 5,
      },
    });
    delete (global.window as { Notification?: unknown }).Notification;
    const { result } = renderHook(() => useAppInstall());
    await act(async () => {});

    expect(result.current.pushNotice).toBeNull();
  });

  it('si el navegador no tiene serviceWorker, no cuenta como soporte de push', async () => {
    // Las tres APIs hacen falta. Quitando solo una, el aviso de iPhone no debe
    // aparecer: sin service worker no hay a quién preguntar por la suscripción, y
    // el interruptor queda desactivado, así que un aviso de instalar ahí sería
    // una instrucción que no lleva a ninguna parte.
    stubBrowser();
    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: { userAgent: UA_IPHONE, vendor: 'Apple Computer, Inc.', maxTouchPoints: 5 },
    });
    const { result } = renderHook(() => useAppInstall());
    await act(async () => {});

    expect(result.current.pushNotice).toBeNull();
  });

  it('un iPad con navegador que se anuncia como Mac se detecta como iOS', () => {
    // El hook tiene que leer los puntos de contacto, no solo suzar la función pura
    // con un string. Si `readPlatform` dejara de mirar `navigator.maxTouchPoints`,
    // el iPad volvería a caer en escritorio y la tarjeta le diría que su
    // navegador no puede instalar, que es falso, sin que nada se entere.
    stubBrowser();
    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: {
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        vendor: 'Google Inc.',
        serviceWorker: {},
        maxTouchPoints: 5,
      },
    });
    const { result } = renderHook(() => useAppInstall());

    expect(result.current.platform).toBe('ios');
    expect(result.current.view.steps.join(' ')).toContain('Compartir');
  });

  it('un Mac sin puntos de contacto se queda en escritorio, no en iOS', () => {
    // El caso contrario, y el que hace daño: si el valor por defecto fuera "tiene
    // touchscreen", un Mac con Safari recibiría los pasos de iPhone, que en macOS
    // no existen.
    stubBrowser();
    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: {
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
        vendor: 'Apple Computer, Inc.',
        serviceWorker: {},
      },
    });
    const { result } = renderHook(() => useAppInstall());

    expect(result.current.platform).toBe('desktop');
    expect(result.current.view.steps.join(' ')).not.toContain('Compartir');
  });

  it('appinstalled vacía el evento, para no ofrecer un botón con el evento gastado', () => {
    // Si la persona acepta el diálogo del propio navegador en vez del botón de
    // la app, el evento ya está gastado. Sin vaciarlo, quien entrara después vería
    // un botón que al pulsarlo falla sin explicación.
    const browser = stubBrowser();
    const { result } = renderHook(() => useAppInstall());
    act(() => {
      browser.emit('beforeinstallprompt', eventoInstallPrompt(true));
    });
    expect(result.current.view.actionIsPrompt).toBe(true);

    act(() => {
      browser.emit('appinstalled', {});
    });

    expect(result.current.view.action).toBeNull();
    expect(result.current.view.title).toBe('App instalada');

    const segundo = renderHook(() => useAppInstall());
    expect(segundo.result.current.view.action).toBeNull();
  });

  it('con dos pantallas montadas a la vez, hay un solo listener y las dos lo ven', () => {
    // El enganche es único a propósito: dos listeners harían que el `prompt()` se
    // consumiera en el sitio equivocado. Y el evento tiene que llegar a las dos,
    // que es lo que evita que la segunda pantalla diga que no se puede instalar.
    const browser = stubBrowser();
    const primera = renderHook(() => useAppInstall());
    const segunda = renderHook(() => useAppInstall());
    expect(browser.count('beforeinstallprompt')).toBe(1);

    act(() => {
      browser.emit('beforeinstallprompt', eventoInstallPrompt(true));
    });

    expect(primera.result.current.view.actionIsPrompt).toBe(true);
    expect(segunda.result.current.view.actionIsPrompt).toBe(true);

    // Y al soltar una, la otra sigue recibiendo.
    primera.unmount();
    act(() => {
      browser.emit('appinstalled', {});
    });
    expect(segunda.result.current.standalone).toBe(true);
  });

  it('al desmontar, suelta su suscripción al almacén', () => {
    // Una fuga aquí no se ve desde fuera: el Set crece en cada montaje de Ajustes
    // y cada elemento es un componente que ya no existe. Por eso se cuenta.
    const browser = stubBrowser();
    const { unmount } = renderHook(() => useAppInstall());
    expect(subscriberCountForTests()).toBe(1);

    unmount();

    expect(subscriberCountForTests()).toBe(0);
    expect(browser.count('beforeinstallprompt')).toBe(1);
  });

  it('al volver a una pestaña normal tras cerrar la app, deja de darla por instalada', () => {
    // La app instalada se abre en su propia ventana. Al cerrarla se vuelve a una
    // pestaña normal, y el evento `change` de `display-mode` es lo unico que lo
    // avisa. Sin escucharlo, la tarjeta se queda diciendo "App instalada" en una
    // pestaña que no lo esta, y el boton de instalar no vuelve a aparecer.
    const browser = stubBrowser({ standalone: true });
    const { result } = renderHook(() => useAppInstall());
    expect(result.current.standalone).toBe(true);

    // El navegador vuelve a una pestaña normal.
    browser.setStandalone(false);
    act(() => {
      browser.fireDisplayMode();
    });

    expect(result.current.standalone).toBe(false);
    // Vuelve a la vista que corresponde a una pestaña normal, no a la de app
    // instalada. Sin el evento no hay boton, pero la tarjeta ya no miente.
    expect(result.current.view.title).not.toBe('App instalada');
    expect(result.current.view.visible).toBe(true);
  });

  it('al desmontar, suelta los listeners de la pantalla y se queda con el del modulo', () => {
    // El de `beforeinstallprompt` se queda a proposito: vive en el modulo para
    // no perder el evento si Ajustes monta tarde, y no se va con la pantalla. Lo
    // que no puede quedarse es nada que llame a `setState` de un componente ya
    // desmontado, asi que lo que se suelta es la suscripcion a ese evento y los
    // listeners propios de la pantalla.
    const browser = stubBrowser();
    const { unmount } = renderHook(() => useAppInstall());
    expect(browser.count('appinstalled')).toBe(1);
    expect(browser.displayModeListenerCount()).toBe(1);

    unmount();

    expect(browser.count('appinstalled')).toBe(0);
    expect(browser.displayModeListenerCount()).toBe(0);
    // El del modulo sigue, que es lo que hace que el evento no se pierda.
    expect(browser.count('beforeinstallprompt')).toBe(1);
  });

  it('un evento que llega con la pantalla ya cerrada no rompe nada', () => {
    // El efecto ya no está, así que no hay a quién avisar. Sin retirar la
    // suscripción, esto sería un `setState` en un componente desmontado.
    const browser = stubBrowser();
    const { unmount } = renderHook(() => useAppInstall());
    unmount();

    expect(() => browser.emit('beforeinstallprompt', eventoInstallPrompt(true))).not.toThrow();
    expect(() => browser.emit('appinstalled', {})).not.toThrow();
    expect(() => browser.fireDisplayMode()).not.toThrow();
  });
});
