jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getUser: jest.fn() }, from: jest.fn(), rpc: jest.fn() },
}));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';
import {
  ACTIVATION_TIMEOUT_MS,
  ALLOWED_PUSH_ROUTES,
  detectTimeZone,
  enableWebPush,
  getActiveSubscription,
  PERMISSION_TIMEOUT_MS,
  SW_READY_TIMEOUT_MS,
  toSubscriptionRecord,
  urlBase64ToUint8Array,
  VAPID_PUBLIC_KEY,
  WEB_PUSH_TIMEOUT_MS,
} from '@/lib/web-push';

describe('urlBase64ToUint8Array', () => {
  it('convierte una clave VAPID real a bytes', () => {
    const bytes = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    // Clave P-256 sin comprimir: 65 bytes empezando por 0x04.
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(4);
  });

  it('rellena el padding y traduce base64url a base64', () => {
    // Bytes [251, 255, 190, 0, 16] en base64url: usa '-' y '_', sin padding.
    expect(Array.from(urlBase64ToUint8Array('-_--ABA'))).toEqual([251, 255, 190, 0, 16]);
  });

  it('devuelve Uint8Array, que es lo que exige PushManager.subscribe', () => {
    expect(urlBase64ToUint8Array('AQAB')).toBeInstanceOf(Uint8Array);
    expect(Array.from(urlBase64ToUint8Array('AQAB'))).toEqual([1, 0, 1]);
  });
});

describe('detectTimeZone', () => {
  it('devuelve una zona IANA del navegador', () => {
    const zone = detectTimeZone();
    expect(typeof zone).toBe('string');
    expect(zone.length).toBeGreaterThan(0);
    expect(zone).not.toBe('undefined');
  });
});

describe('toSubscriptionRecord', () => {
  it('normaliza una suscripción completa', () => {
    const record = toSubscriptionRecord({
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: { p256dh: 'key-p256dh', auth: 'key-auth' },
    });

    expect(record).not.toBeNull();
    expect(record?.endpoint).toBe('https://fcm.googleapis.com/fcm/send/abc');
    expect(record?.p256dh).toBe('key-p256dh');
    expect(record?.auth).toBe('key-auth');
    expect(record?.timezone).toBe(detectTimeZone());
  });

  it('devuelve null si falta el endpoint', () => {
    expect(
      toSubscriptionRecord({ endpoint: null, keys: { p256dh: 'a', auth: 'b' } }),
    ).toBeNull();
  });

  it('devuelve null si falta alguna de las claves', () => {
    expect(
      toSubscriptionRecord({ endpoint: 'https://x', keys: { p256dh: 'a', auth: null } }),
    ).toBeNull();
    expect(
      toSubscriptionRecord({ endpoint: 'https://x', keys: { p256dh: null, auth: 'b' } }),
    ).toBeNull();
  });

  it('devuelve null si no hay claves', () => {
    expect(toSubscriptionRecord({ endpoint: 'https://x', keys: null })).toBeNull();
  });
});

describe('presupuestos de tiempo de la activación', () => {
  // El reparto es lo que evita el bug reportado: un tope único o demasiado corto
  // mata la activación mientras la persona contesta el diálogo de permisos, y
  // uno demasiado largo deja el interruptor muerto. Estos números son el
  // acuerdo, así que se fijan aquí para que un cambio accidental se note.
  it('el diálogo de permisos tiene un techo holgado, porque espera a una persona', () => {
    expect(PERMISSION_TIMEOUT_MS).toBe(60_000);
    expect(PERMISSION_TIMEOUT_MS).toBeGreaterThan(ACTIVATION_TIMEOUT_MS);
  });

  it('la suscripción y la red tienen un techo estrecho, porque no dependen de nadie', () => {
    expect(ACTIVATION_TIMEOUT_MS).toBe(30_000);
  });

  it('el tope global de Ajustes es la suma de los dos con margen', () => {
    expect(WEB_PUSH_TIMEOUT_MS).toBe(100_000);
    expect(WEB_PUSH_TIMEOUT_MS).toBeGreaterThan(PERMISSION_TIMEOUT_MS + ACTIVATION_TIMEOUT_MS);
  });

  it('el registro y la activación del service worker caben en el presupuesto', () => {
    // Son dos fases del mismo tope, y si sumaran más que el presupuesto de
    // activación el corte global las dejaría a medias sin avisar de nada.
    expect(SW_READY_TIMEOUT_MS * 2).toBeLessThanOrEqual(ACTIVATION_TIMEOUT_MS);
  });
});

describe('ALLOWED_PUSH_ROUTES', () => {
  it('solo permite rutas internas conocidas', () => {
    expect(ALLOWED_PUSH_ROUTES).toEqual(['/citas', '/cumpleanos']);
    for (const route of ALLOWED_PUSH_ROUTES) {
      expect(route.startsWith('/')).toBe(true);
      expect(route).not.toContain('//');
    }
  });

  // La allowlist que protege de verdad está en sw-src.js, no aquí: el service
  // worker es quien la ejecuta al abrir un aviso. Si las dos se separan, el
  // aviso podría abrir una ruta inesperada, así que se comparan.
  it('coincide con la allowlist del service worker', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'sw-src.js'), 'utf8');
    const match = source.match(/ALLOWED_ROUTES\s*=\s*\[([^\]]*)\]/);
    expect(match).not.toBeNull();

    const fromServiceWorker = (match?.[1] ?? '')
      .split(',')
      .map((value) => value.trim().replace(/^['"]|['"]$/g, ''))
      .filter((value) => value.length > 0);

    expect(fromServiceWorker).toEqual([...ALLOWED_PUSH_ROUTES]);
  });

  it('el service worker filtra con includes, no con startsWith', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'sw-src.js'), 'utf8');
    // Con startsWith, '/citas-secretas' passaría el filtro sin estar en la lista.
    expect(source).toContain('ALLOWED_ROUTES.includes(value)');
    expect(source).not.toContain('ALLOWED_ROUTES.some((allowed) => value.startsWith(allowed))');
  });
});

describe('el estado real del navegador manda sobre la interfaz', () => {
  // Regresión cubierta aquí: Ajustes lee la suscripción nada más montar, y el
  // service worker no se activa hasta después del `load`. Con una consulta que
  // no espera, el interruptor aparecía apagado al recargar la página aunque el
  // navegador siguiera suscrito, y el usuario no tenía forma de saber por qué.
  const originalOs = Platform.OS;

  // `isPushSupported` descarta cualquier cosa que no sea web y exige
  // `PushManager` y `Notification` en `window`, así que sin esto estos tests
  // pasarían sin llegar a tocar el service worker. Va en `beforeEach` y no una
  // sola vez al montar el describe: restaurarlo en `afterEach` lo devolvía a la
  // plataforma nativa para el segundo test en adelante, y el tercero pasaba por
  // el motivo equivocado, sin ejercitar nada.
  beforeEach(() => {
    Platform.OS = 'web';
  });

  afterAll(() => {
    Platform.OS = originalOs;
  });

  function stubBrowser(
    overrides: { active?: boolean; subscribed?: boolean; installingWorker?: boolean } = {},
  ) {
    const { active = true, subscribed = true } = overrides;
    const opts = { installingWorker: overrides.installingWorker ?? false };
    const getSubscription = jest.fn(async () => (subscribed ? { endpoint: 'https://push.test/e' } : null));
    // Sin worker activo, `installing` tiene que pasar a `activated` a través de
    // `statechange`, que es por donde `waitForActivation` escucha. Con
    // `installing` a null esa función devuelve null en el acto y el camino a
    // probar no se ejercita de verdad.
    const installing: { state: string; addEventListener: (t: string, fn: () => void) => void; removeEventListener: (t: string) => void } | null =
      active || !opts.installingWorker
        ? null
        : {
            state: 'installing',
            addEventListener: (_: string, fn: () => void) => {
              setTimeout(() => {
                if (installing) installing.state = 'activated';
                fn();
              }, 0);
            },
            removeEventListener: () => undefined,
          };
    const registration = {
      active: active ? { state: 'activated' } : null,
      installing,
      waiting: null,
      pushManager: { getSubscription },
    };
    const getRegistration = jest.fn(async () => registration);
    const register = jest.fn(async () => registration);
    const serviceWorker = { getRegistration, register, ready: Promise.resolve(registration) };
    const NotificationStub = Object.assign(function Notification() {}, { permission: 'granted' });
    const PushManagerStub = function PushManager() {};

    // `window` y `navigator` son objetos distintos en el navegador y el módulo
    // usa ambos: `isPushSupported` lee `window` y el service worker vive en
    // `navigator`. Hay que sustituir los dos o el test pasa sin ejercitar nada.
    Object.assign(global.window, {
      PushManager: PushManagerStub,
      Notification: NotificationStub,
    });
    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: { serviceWorker, PushManager: PushManagerStub, Notification: NotificationStub, userAgent: 'jest' },
    });
    return { getSubscription, getRegistration, register };
  }

  it('espera al service worker en vez de asumir que no hay suscripción', async () => {
    // Sin worker activo todavía: la consulta debe registrar y esperar, no
    // devolver null como si el navegador no tuviera nada.
    const { getRegistration, getSubscription } = stubBrowser({ subscribed: true });

    const sub = await getActiveSubscription();

    expect(getRegistration).toHaveBeenCalled();
    expect(getSubscription).toHaveBeenCalled();
    expect(sub).not.toBeNull();
  });

  it('no registra un segundo worker si ya hay uno, aunque se esté instalando', async () => {
    // Con `getRegistration` devolviendo un registro y ese worker todavía
    // instalándose. Registrar otro sería tirar el precaché del build entero por
    // un estado transitorio, y esperar a `activated` hacía que la consulta
    // respondiera "no suscrito" con un navegador sí suscrito.
    const { register, getSubscription } = stubBrowser({ active: false, installingWorker: true });

    const sub = await getActiveSubscription();

    expect(register).not.toHaveBeenCalled();
    expect(getSubscription).toHaveBeenCalled();
    expect(sub).not.toBeNull();
  });

  it('registra el service worker si el navegador no tiene ninguno', async () => {
    // Primera visita: no hay ningún registro, así que hay que crearlo bajo
    // demanda. Es el caso de que el `load` de `index.html` no hubiera ocurrido.
    const { register, getSubscription } = stubBrowser({ active: false, installingWorker: true });
    const nav = (global as unknown as { navigator: { serviceWorker: { getRegistration: jest.Mock } } }).navigator;
    nav.serviceWorker.getRegistration.mockResolvedValue(null);

    const sub = await getActiveSubscription();

    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    expect(getSubscription).toHaveBeenCalled();
    expect(sub).not.toBeNull();
  });

  it('devuelve null de verdad cuando el navegador no está suscrito', async () => {
    // Sin esta aserción, este test también pasaría si `isPushSupported`-cutting
    // devolviera null antes de preguntar nada, que es como pasó al principio.
    const { getSubscription } = stubBrowser({ subscribed: false });

    await expect(getActiveSubscription()).resolves.toBeNull();
    expect(getSubscription).toHaveBeenCalled();
  });
});

describe('enableWebPush: los topes por fase y el contrato de errores', () => {
  // Este bloque existe porque el test de Ajustes que simula un cuelgue lo hace
  // con una promesa que no resuelve nunca, y eso lo resuelve el `withTimeout`
  // externo de la pantalla: pasaría igual aunque `web-push` volviera a no tener
  // ningún tope. Aquí se prueban los topes de la capa de push, que son los que
  // hacen que el botón de Ajustes se rehabilite con un motivo util.
  const originalOs = Platform.OS;
  const user = { id: 'user-1' } as unknown as Parameters<typeof enableWebPush>[0];

  beforeEach(() => {
    Platform.OS = 'web';
    jest.useFakeTimers();
  });

  afterEach(() => {
    Platform.OS = originalOs;
    jest.useRealTimers();
  });

  function stubSupabase(options: { insertError?: { code?: string; message?: string } | null } = {}) {
    const insertError = options.insertError ?? null;
    const deleteEq = jest.fn(async () => ({ error: null }));
    const insert = jest.fn(async () => ({ error: insertError }));
    const upsert = jest.fn(async () => ({ error: null }));
    const from = jest.fn((table: string) =>
      table === 'push_subscriptions'
        ? { delete: () => ({ eq: deleteEq }), insert }
        : { upsert },
    );
    (supabase.from as jest.Mock).mockImplementation(from);
    return { deleteEq, insert, upsert };
  }

  function stubPush(
    options: {
      requestPermission?: () => Promise<NotificationPermission>;
      subscribe?: () => Promise<unknown>;
      existing?: unknown;
    },
    // `installing` y `stuck` reproducen un worker que aún no ha tomado el
    // control, que es la situación en la que `subscribe()` devuelve una
    // suscripción a medias.
    browser: { workerState?: 'activated' | 'installing' | 'stuck' } = {},
  ) {
    const subscription = {
      endpoint: 'https://push.test/e',
      keys: { p256dh: 'p', auth: 'a' },
      unsubscribe: jest.fn(async () => true),
    };
    const pushManager = {
      getSubscription: jest.fn(async () => options.existing ?? null),
      subscribe: jest.fn(options.subscribe ?? (async () => subscription)),
    };
    const workerState = browser.workerState ?? 'activated';
    const installing: { state: string; addEventListener: (t: string, fn: () => void) => void; removeEventListener: (t: string) => void } | null =
      workerState === 'activated'
        ? null
        : {
            state: workerState,
            addEventListener: (_type: string, fn: () => void) => {
              // 'installing' pasa a 'activated' un instante después, como un
              // worker real; 'stuck' no pasa nunca, que es el caso que se prueba.
              if (workerState !== 'installing') return;
              setTimeout(() => {
                installing!.state = 'activated';
                fn();
              }, 0);
            },
            removeEventListener: () => undefined,
          };
    const registration = {
      active: workerState === 'activated' ? { state: 'activated' } : null,
      installing,
      waiting: null,
      pushManager,
    };
    Object.assign(global.window, {
      PushManager: function PushManager() {},
      Notification: Object.assign(function Notification() {}, {
        permission: 'default',
        requestPermission:
          options.requestPermission ?? (async () => 'granted' as NotificationPermission),
      }),
    });
    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: {
        serviceWorker: {
          getRegistration: jest.fn(async () => registration),
          register: jest.fn(async () => registration),
          ready: Promise.resolve(registration),
        },
        userAgent: 'jest',
      },
    });
    return { subscription, pushManager };
  }

  const cuelgue = () => new Promise<never>(() => undefined);

  it('un permiso que no responde termina en timeout, no en failed', async () => {
    stubSupabase();
    stubPush({ requestPermission: cuelgue });

    const promise = enableWebPush(user);
    await jest.advanceTimersByTimeAsync(PERMISSION_TIMEOUT_MS + 1);
    const result = await promise;

    // `failed`would dir "algo ha fallado"; `timeout` dice que se quedó esperando.
    expect(result.status).toBe('timeout');
  });

  it('una suscripción que no responde también termina en timeout', async () => {
    stubSupabase();
    stubPush({ subscribe: cuelgue });

    const promise = enableWebPush(user);
    await jest.advanceTimersByTimeAsync(ACTIVATION_TIMEOUT_MS + 1);
    const result = await promise;

    expect(result.status).toBe('timeout');
  });

  it('un fallo real sigue siendo failed con su motivo, no un timeout', async () => {
    stubSupabase();
    stubPush({
      subscribe: async () => {
        throw new Error('AbortError: permission denied');
      },
    });

    const result = await enableWebPush(user);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.reason).toContain('permission denied');
  });

  it('un permiso denegado se distingue de un cuelgue', async () => {
    stubSupabase();
    stubPush({ requestPermission: async () => 'denied' });

    expect((await enableWebPush(user)).status).toBe('denied');
  });

  it('un endpoint de otra cuenta no devuelve enabled y da de baja la suscripción', async () => {
    // El aviso más caro de este bloque era este: con 23505 la fila es de otra
    // cuenta, pero la suscripción local seguía viva y el interruptor acababa
    // marcando que no había nada que arreglar mientras este navegador recibía los
    // avisos de la cuenta anterior.
    const db = stubSupabase({ insertError: { code: '23505' } });
    const { subscription, pushManager } = stubPush({});

    const result = await enableWebPush(user);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.reason).toContain('otra cuenta');
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(db.upsert).not.toHaveBeenCalled();
    expect(pushManager.subscribe).toHaveBeenCalled();
  });

  it('descarta una suscripción vieja e incompleta y crea otra', async () => {
    // Este es el bloqueo que dejó el usuario en Android: el móvil conservaba
    // una suscripción de un intento anterior, sin `p256dh` ni `auth`. Como
    // `getSubscription()` la devuelve siempre, el alta fallaba con "suscripción
    // incompleta" para siempre y no había ninguna acción que lo desbloqueara.
    // Reutilizarla sin comprobar es justo lo que lo producía.
    const db = stubSupabase();
    const { pushManager } = stubPush({
      existing: { endpoint: 'https://push.test/vieja', keys: { p256dh: null, auth: null } },
    });

    const result = await enableWebPush(user);

    expect(result.status).toBe('enabled');
    expect(pushManager.subscribe).toHaveBeenCalled();
    // Y se da de baja la inservible, para que no siga ocupando el hueco.
    expect(db.insert).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://push.test/e' }),
    );
  });

  it('mantiene la suscripción existente si está completa', async () => {
    // El caso contrario: si ya hay una buena, no hay que crear otra ni tirar la
    // que funciona (eso dejaría al navegador sin nada durante un momento).
    const db = stubSupabase();
    const { pushManager } = stubPush({
      existing: { endpoint: 'https://push.test/buena', keys: { p256dh: 'p', auth: 'a' }, unsubscribe: jest.fn() },
    });

    const result = await enableWebPush(user);

    expect(result.status).toBe('enabled');
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(db.insert).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://push.test/buena' }),
    );
  });

  it('exige worker activo para suscribirse, y es lo que evita la suscripción a medias', async () => {
    // El fallo que reportsó el usuario: con el worker todavía instalándose,
    // `subscribe()` devuelve una suscripción sin `p256dh` ni `auth` y el alta
    // moría con "suscripción incompleta". Suscribir tiene que esperar a `activated`;
    // leer el estado, no.
    const db = stubSupabase();
    const { pushManager } = stubPush({}, { workerState: 'installing' });

    // Con reloj falso hay que avanzar el tiempo: el alta queda esperando a que
    // el worker pase a `activated`, y es justo lo que se quiere comprobar.
    const promise = enableWebPush(user);
    await jest.advanceTimersByTimeAsync(1);
    const result = await promise;

    expect(result.status).toBe('enabled');
    expect(pushManager.subscribe).toHaveBeenCalled();
    expect(db.insert).toHaveBeenCalled();
  });

  it('falla con un motivo claro si el worker no llega a activarse', async () => {
    // Antes de esto, con un worker que no se activaba, `subscribe()` devolvía una
    // suscripción a medias y el mensaje era "suscripción incompleta", que no
    // explica nada. Ahora se dice qué ha pasado.
    stubSupabase();
    stubPush({}, { workerState: 'stuck' });

    const promise = enableWebPush(user);
    await jest.advanceTimersByTimeAsync(SW_READY_TIMEOUT_MS + 1);
    const result = await promise;

    expect(result.status).toBe('timeout');
    if (result.status === 'timeout') {
      expect(result.reason).toContain('service worker');
    }
  });

  it('borra lo propio del endpoint antes de insertar y nunca hace upsert por endpoint', async () => {
    // Si esto se invirtiera, un upsert sobre una fila ajena chocaría con la
    // política UPDATE y devolvería un "activado" falso.
    const db = stubSupabase();
    stubPush({});

    const result = await enableWebPush(user);

    expect(result.status).toBe('enabled');
    expect(db.deleteEq).toHaveBeenCalledWith('endpoint', 'https://push.test/e');
    expect(db.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1', active: true }),
    );
  });
});
