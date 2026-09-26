jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getUser: jest.fn(), getSession: jest.fn() }, from: jest.fn(), rpc: jest.fn() },
}));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';
import { SUBSCRIBE_FAILURE_MESSAGES } from '@/lib/push-failures';
import {
  ACTIVATION_TIMEOUT_MS,
  incompleteReason,
  INCOMPLETE_MESSAGES,
  ALLOWED_PUSH_ROUTES,
  detectTimeZone,
  disableWebPush,
  enableWebPush,
  getActiveSubscription,
  PERMISSION_TIMEOUT_MS,
  sendTestPush,
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
    const fromPushLog = jest.fn(async (_row: Record<string, unknown>) => ({ error: null }));
    const from = jest.fn((table: string) =>
      table === 'push_subscriptions'
        ? { delete: () => ({ eq: deleteEq }), insert }
        : table === 'push_log'
          ? { insert: fromPushLog }
          : { upsert },
    );
    (supabase.from as jest.Mock).mockImplementation(from);
    return { deleteEq, insert, upsert, fromPushLog };
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
    // Antes este test exigía que el motivo fuera el texto en inglés del
    // navegador. Fijaba justo lo que este arreglo quita: una persona no puede
    // hacer nada con "permission denied" y sí con el motivo accionable.
    stubSupabase();
    stubPush({
      subscribe: async () => {
        const e = new Error('AbortError: permission denied');
        e.name = 'AbortError';
        throw e;
      },
    });

    const result = await enableWebPush(user);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe(SUBSCRIBE_FAILURE_MESSAGES['permiso']);
      expect(result.reason).not.toMatch(/permission denied/i);
    }
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

  it('distingue qué parte de la suscripción falta, en vez de decir "incompleta"', async () => {
    // "Suscripción incompleta" no distingue entre que falte la clave de
    // cifrado y la de autenticación, y esas dos tienen causas distintas. Dos
    // arreglos seguidos salieron de suponer mal cuál era.
    expect(incompleteReason({ endpoint: 'https://e', keys: null })).toBe('sin-claves');
    expect(incompleteReason({ endpoint: 'https://e', keys: { p256dh: 'p', auth: null } })).toBe('sin-auth');
    expect(incompleteReason({ endpoint: 'https://e', keys: { p256dh: null, auth: 'a' } })).toBe('sin-p256dh');
    expect(incompleteReason({ endpoint: null, keys: { p256dh: 'p', auth: 'a' } })).toBe('sin-endpoint');
    expect(incompleteReason({ endpoint: 'https://e', keys: { p256dh: 'p', auth: 'a' } })).toBeNull();
  });

  it('cada motivo tiene un mensaje distinto y accionable', () => {
    for (const [reason, message] of Object.entries(INCOMPLETE_MESSAGES)) {
      expect(message.length).toBeGreaterThan(30);
      expect(message).not.toContain('incompleta');
      // Se usa como prefijo en `push_log`, así que no puede llevar nada raro.
      expect(reason).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('anota en push_log por qué falló el alta, solo con el motivo', async () => {
    // El registro es lo que permite diagnosticar sin depender de que nadie
    // describa lo que ve. Y no puede llevar datos de la suscripción: las claves
    // de cifrado no tienen nada que ver con el diagnóstico.
    const db = stubSupabase();
    stubPush({
      subscribe: async () => ({ endpoint: 'https://e', keys: { p256dh: 'p', auth: null } }),
    });

    const result = await enableWebPush(user);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.reason).toBe(INCOMPLETE_MESSAGES['sin-auth']);
    const logInsert = db.fromPushLog.mock.calls[0]?.[0] as { dedupe_key?: string } | undefined;
    expect(logInsert?.dedupe_key).toMatch(/^alta:sin-auth:/);
    expect(JSON.stringify(logInsert)).not.toContain('p256dh');
  });

  it('convierte el AbortError del navegador en un motivo accionable y lo anota', async () => {
    // Lo que se vivía leyendo: "Registration failed - push service not available",
    // en inglés y sin decir qué hacer. Medido en un Chromium real.
    const db = stubSupabase();
    stubPush({
      subscribe: async () => {
        const e = new Error('Registration failed - push service not available');
        e.name = 'AbortError';
        throw e;
      },
    });

    const result = await enableWebPush(user);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe(SUBSCRIBE_FAILURE_MESSAGES['sin-servicio-push']);
      expect(result.reason).not.toMatch(/Registration failed/i);
    }
    const logInsert = db.fromPushLog.mock.calls[0]?.[0] as { dedupe_key?: string } | undefined;
    expect(logInsert?.dedupe_key).toMatch(/^alta:sin-servicio-push:/);
  });

  it('anota el fallo del navegador sin filtrar la suscripción', async () => {
    const db = stubSupabase();
    stubPush({
      subscribe: async () => {
        const e = new Error('boom');
        e.name = 'InvalidStateError';
        throw e;
      },
    });

    await enableWebPush(user);

    const logInsert = db.fromPushLog.mock.calls[0]?.[0] as { dedupe_key?: string } | undefined;
    expect(logInsert?.dedupe_key).toMatch(/^alta:worker-inactivo:/);
    expect(JSON.stringify(logInsert)).not.toContain('p256dh');
  });

  it('no inserta la suscripción cuando el navegador no la ha creado', async () => {
    // El alta de una suscripción que no existe daría una suscripción fantasma que
    // luego no recibe nada.
    const db = stubSupabase();
    stubPush({
      subscribe: async () => {
        const e = new Error('Registration failed');
        e.name = 'AbortError';
        throw e;
      },
    });

    await enableWebPush(user);

    expect(db.insert).not.toHaveBeenCalled();
    // Tampoco la preferencia: si queda marcada como activa sin suscripción, el
    // interruptor miente y el aviso de Ajustes no cuadra con nada.
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it('si la anotación del motivo se cuelga, el motivo del fallo sigue llegando', async () => {
    // El Symptoma sería "no ha terminado a tiempo" en lugar de "Play Services",
    // que es justo el motivo que hacía falta. La anotación es un extra: si se
    // cuelga, se traga ella sola.
    const colgado = new Promise<never>(() => {
      /* nunca resuelve, como una petición que se queda colgada */
    });
    const db = stubSupabase();
    (supabase.from as jest.Mock).mockImplementation((table: string) =>
      table === 'push_subscriptions'
        ? { delete: () => ({ eq: jest.fn(async () => ({ error: null })) }), insert: db.insert }
        : table === 'push_log'
          ? { insert: jest.fn(() => colgado) }
          : { upsert: db.upsert },
    );
    stubPush({
      subscribe: async () => {
        const e = new Error('Registration failed - push service not available');
        e.name = 'AbortError';
        throw e;
      },
    });

    const promise = enableWebPush(user);
    // Se avanza solo lo que tarda la anotación, muy por debajo del tope del alta.
    await jest.advanceTimersByTimeAsync(3001);
    const result = await promise;

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe(SUBSCRIBE_FAILURE_MESSAGES['sin-servicio-push']);
    }
  });

  it('si ya hay una suscripción buena, no vuelve a pedirla al navegador', async () => {
    // Un fallo del servicio push no puede hacer que se pida una suscripción nueva
    // a un navegador que ya tiene una válida: solo se pide si no hay.
    const db = stubSupabase();
    const push = stubPush({
      existing: { endpoint: 'https://push.test/buena', keys: { p256dh: 'p', auth: 'a' }, unsubscribe: jest.fn() },
    });

    const result = await enableWebPush(user);

    expect(result.status).toBe('enabled');
    expect(push.pushManager.subscribe).not.toHaveBeenCalled();
    expect(db.fromPushLog).not.toHaveBeenCalled();
  });

  it('el conjunto de motivos de la politica de push_log', () => {
    // La politica de RLS cierra el conjunto de motivos, y el motivo de que se
    // cerrara es que ese conjunto no se note al añadir uno nuevo: si un motivo
    // falta en la politica, el insert falla con 42501 y el error se traga, y el
    // fallo vuelve a no registrarse sin que nadie se entere. Este test es lo que
    // evita ese fallo silencioso.
    const ruta = join(
      __dirname,
      '..',
      '..',
      'supabase',
      'migrations',
      '20260926_push_log_motivos_cerrados.sql',
    );
    const sql = readFileSync(ruta, 'utf8');
    const patron = sql.match(/dedupe_key ~ '\^alta:\(([^)]*)\):\[0-9\]\{14\}\$'/);
    expect(patron).not.toBeNull();
    const permitidos = new Set((patron?.[1] ?? '').split('|'));

    // Las dos fuentes de verdad son los `Record` de mensajes: el typechecker
    // obliga a que contengan todas las claves de su unión, así que sus claves
    // son las uniones enteras y no una lista que se pueda desincronizar.
    for (const motivo of [
      ...Object.keys(INCOMPLETE_MESSAGES),
      ...Object.keys(SUBSCRIBE_FAILURE_MESSAGES),
    ]) {
      expect(permitidos.has(motivo)).toBe(true);
    }

    // Y la política sigue siendo un conjunto cerrado: texto libre rejected.
    expect(sql).toContain('sent_at = now()');
    expect(permitidos.has('inventado')).toBe(false);
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

describe('disableWebPush: la baja tiene que borrar de verdad', () => {
  // `disableWebPush` decide si este navegador sigue recibiendo avisos de una
  // cuenta que el usuario acaba de cerrar en un equipo compartido. Es la funcion
  // que mas caro sale si falla en silencio, y estaba sin un solo test.
  const originalOs = Platform.OS;
  const user = { id: 'user-1' } as unknown as Parameters<typeof disableWebPush>[0];

  beforeEach(() => {
    Platform.OS = 'web';
    jest.useFakeTimers();
  });

  afterEach(() => {
    Platform.OS = originalOs;
    jest.useRealTimers();
  });

  function stubDb(options: { deleteError?: { message?: string } | null } = {}) {
    const deleteError = options.deleteError ?? null;
    const deleteEq = jest.fn(async () => ({ error: deleteError }));
    const upsert = jest.fn(async () => ({ error: null }));
    (supabase.from as jest.Mock).mockImplementation((table: string) =>
      table === 'push_subscriptions' ? { delete: () => ({ eq: deleteEq }) } : { upsert },
    );
    return { deleteEq, upsert };
  }

  // `existing` a undefined significa "la suscripcion que el navegador tiene", que
  // es el mismo objeto que se devuelve, para poder asserting sobre el.
  function stubBrowser(existing?: unknown) {
    const subscription = {
      endpoint: 'https://push.test/e',
      keys: { p256dh: 'p', auth: 'a' },
      unsubscribe: jest.fn(async () => true),
    };
    const registration = {
      active: { state: 'activated' },
      installing: null,
      waiting: null,
      pushManager: {
        getSubscription: jest.fn(async () => (existing === undefined ? subscription : existing)),
        subscribe: jest.fn(),
      },
    };
    Object.assign(global.window, {
      PushManager: function PushManager() {},
      Notification: Object.assign(function Notification() {}, { permission: 'granted' }),
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
    return { subscription };
  }

  it('da de baja la suscripcion, borra su fila y apaga la preferencia', async () => {
    const db = stubDb();
    const { subscription } = stubBrowser();

    const result = await disableWebPush(user);

    expect(result).toEqual({ status: 'disabled' });
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(db.deleteEq).toHaveBeenCalledWith('endpoint', 'https://push.test/e');
    expect(db.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1', enabled: false }),
      { onConflict: 'user_id' },
    );
  });

  it('sin suscripcion en el navegador, apaga la preferencia igualmente', async () => {
    // Si no hay suscripcion no hay nada que borrar, pero la preferencia sigue
    // encendida: el usuario cree que la apago y el backend le manda avisos.
    const db = stubDb();
    stubBrowser(null);

    const result = await disableWebPush(user);

    expect(result).toEqual({ status: 'disabled' });
    expect(db.deleteEq).not.toHaveBeenCalled();
    expect(db.upsert).toHaveBeenCalled();
  });

  it('un borrado que falla en la base no se reporta como baja hecha', async () => {
    // El endpoint es una credencial: si la fila sigue viva, ese navegador
    // seguiria recibiendo avisos aunque la interfaz diga lo contrario.
    stubDb({ deleteError: { message: 'violacion de politicas' } });
    stubBrowser();

    const result = await disableWebPush(user);

    expect(result).toEqual({ status: 'failed', reason: 'violacion de politicas' });
  });

  it('una baja que no termina es timeout, no un fallo que se puede ignorar', async () => {
    stubDb();
    const registration = {
      active: { state: 'activated' },
      installing: null,
      waiting: null,
      pushManager: {
        getSubscription: jest.fn(async () => new Promise<never>(() => undefined)),
        subscribe: jest.fn(),
      },
    };
    Object.assign(global.window, {
      PushManager: function PushManager() {},
      Notification: Object.assign(function Notification() {}, { permission: 'granted' }),
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

    const promise = disableWebPush(user);
    await jest.advanceTimersByTimeAsync(ACTIVATION_TIMEOUT_MS + 10);

    await expect(promise).resolves.toEqual({
      status: 'timeout',
      reason: 'la baja no ha terminado a tiempo',
    });
  });

  it('sin soporte de push no toca nada', async () => {
    const db = stubDb();
    // `isPushSupported` mira si la clave existe, no si el valorTruthy: ponerla a
    // undefined no seria "sin soporte".
    delete (global.window as { PushManager?: unknown }).PushManager;

    const result = await disableWebPush(user);

    expect(result).toEqual({ status: 'unsupported' });
    expect(db.upsert).not.toHaveBeenCalled();
  });
});

describe('sendTestPush: el contrato con la Edge Function', () => {
  // El boton de prueba es como se comprueba a mano que los avisos viven. Si
  // devuelve un texto que no corresponde con lo que paso, el diagnostico manda
  // a la persona por el camino equivocado.
  const originalFetch = global.fetch;

  beforeEach(() => {
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({
      data: { session: { access_token: 'jwt' } },
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function stubFetch(impl: () => Promise<unknown>) {
    const fetchMock = jest.fn(impl);
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  function stubResponse(body: unknown, ok = true) {
    return { ok, json: async () => body } as Response;
  }

  it('devuelve cuantos navegadores han recibido el aviso', async () => {
    stubFetch(async () => stubResponse({ ok: true, delivered: 2 }));

    await expect(sendTestPush()).resolves.toEqual({ ok: true, delivered: 2 });
  });

  it('sin sesion no llama a la funcion', async () => {
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: null } });
    const fetchMock = stubFetch(async () => stubResponse({}));

    await expect(sendTestPush()).resolves.toEqual({ ok: false, error: 'sesión no válida' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un enfriamiento dice cuanto falta, no solo que hay que esperar', async () => {
    // Sin el segundo, la pantalla inventa un minuto y el usuario lo aprieta
    // otra vez y vuelve a Fallar.
    stubFetch(async () => stubResponse({ error: 'demasiado rapido', retryInSeconds: 300 }));

    await expect(sendTestPush()).resolves.toEqual({
      ok: false,
      error: 'demasiado rapido',
      retryInSeconds: 300,
    });
  });

  it('un enfriamiento sin segundos devuelve el minuto por defecto, no undefined', async () => {
    stubFetch(async () => stubResponse({ error: 'demasiado rapido' }));

    await expect(sendTestPush()).resolves.toEqual({
      ok: false,
      error: 'demasiado rapido',
      retryInSeconds: 60,
    });
  });

  it('un error de la funcion llega tal cual, y si no es texto se dice algo', async () => {
    stubFetch(async () => stubResponse({ error: 'sin suscripciones' }, false));
    await expect(sendTestPush()).resolves.toEqual({ ok: false, error: 'sin suscripciones' });

    stubFetch(async () => stubResponse({}, false));
    await expect(sendTestPush()).resolves.toEqual({ ok: false, error: 'error inesperado' });
  });

  it('sin conexion y respuesta ilegible se distinguen', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(sendTestPush()).resolves.toEqual({ ok: false, error: 'sin conexión' });

    stubFetch(async () => ({ ok: true, json: async () => { throw new SyntaxError('no json'); } }));
    await expect(sendTestPush()).resolves.toEqual({ ok: false, error: 'respuesta ilegible' });
  });

  it('un delivered que no es numero cuenta cero, no rompe la pantalla', async () => {
    stubFetch(async () => stubResponse({ ok: true, delivered: 'muchos' }));

    await expect(sendTestPush()).resolves.toEqual({ ok: true, delivered: 0 });
  });
});

