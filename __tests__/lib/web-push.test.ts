jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getUser: jest.fn(), getSession: jest.fn() }, from: jest.fn(), rpc: jest.fn() },
}));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';
import { SUBSCRIBE_FAILURE_MESSAGES } from '@/lib/push-failures';
import { reminderChoices } from '@/lib/notification-schedule';
import { PREFS_READ_TIMEOUT_MS } from '@/lib/web-push-timeouts';
import {
  ACTIVATION_TIMEOUT_MS,
  CLAVES_PASO_MS,
  CLAVES_TIMEOUT_MS,
  SW_READY_TIMEOUT_MS,
  incompleteReason,
  INCOMPLETE_MESSAGES,
  ALLOWED_PUSH_ROUTES,
  detectTimeZone,
  disableWebPush,
  enableWebPush,
  getActiveSubscription,
  getStoredBirthdayChoice,
  PERMISSION_TIMEOUT_MS,
  sendTestPush,
  syncPushPreferences,
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
    const mockGet = jest.fn((name: 'p256dh' | 'auth') => {
      if (name === 'p256dh') return new TextEncoder().encode('key-p256dh').buffer;
      if (name === 'auth') return new TextEncoder().encode('key-auth').buffer;
      return null;
    });
    const record = toSubscriptionRecord({
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: { get: mockGet },
    });

    expect(record).not.toBeNull();
    expect(record?.endpoint).toBe('https://fcm.googleapis.com/fcm/send/abc');
    expect(record?.p256dh).toBe('a2V5LXAyNTZkaA');
    expect(record?.auth).toBe('a2V5LWF1dGg');
    expect(record?.timezone).toBe(detectTimeZone());
  });

  it('devuelve null si falta el endpoint', () => {
    const mockGet = jest.fn(() => new TextEncoder().encode('a').buffer);
    expect(
      toSubscriptionRecord({ endpoint: null, keys: { get: mockGet } }),
    ).toBeNull();
  });

  it('devuelve null si falta alguna de las claves', () => {
    const mockGetMissing = jest.fn((name: 'p256dh' | 'auth') => (name === 'p256dh' ? new TextEncoder().encode('a').buffer : null));
    expect(
      toSubscriptionRecord({ endpoint: 'https://x', keys: { get: mockGetMissing } }),
    ).toBeNull();
    const mockGetMissingAuth = jest.fn((name: 'p256dh' | 'auth') => (name === 'auth' ? new TextEncoder().encode('b').buffer : null));
    expect(
      toSubscriptionRecord({ endpoint: 'https://x', keys: { get: mockGetMissingAuth } }),
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
    expect(PERMISSION_TIMEOUT_MS).toBe(65_000);
    expect(PERMISSION_TIMEOUT_MS).toBeGreaterThan(ACTIVATION_TIMEOUT_MS);
  });

  it('la suscripción y la red tienen un techo estrecho, porque no dependen de nadie', () => {
    // Subió a 60 s para pagar la espera de las claves en Redmi/Xiaomi lentos.
    // Con 35 s no había margen: el registro del worker puede gastar 20 s y para
    // FCM, la red y la espera de 30 s quedaban ~10 s.
    expect(ACTIVATION_TIMEOUT_MS).toBe(60_000);
  });

  it('el tope global de Ajustes es la suma de los dos con margen', () => {
    expect(WEB_PUSH_TIMEOUT_MS).toBe(135_000);
    expect(WEB_PUSH_TIMEOUT_MS).toBeGreaterThan(PERMISSION_TIMEOUT_MS + ACTIVATION_TIMEOUT_MS);
  });

  it('el registro, la activación y la espera de las claves caben en el presupuesto', () => {
    // El reparto de tiempos es lo que evita que el corte global se coma una fase
    // sin avisar. Con la espera de 30 s, el test anterior no la miraba: por eso
    // faltaba esta fase en el reparto.
    expect(SW_READY_TIMEOUT_MS * 2).toBeLessThanOrEqual(ACTIVATION_TIMEOUT_MS);
    const conClaves = SW_READY_TIMEOUT_MS * 2 + CLAVES_TIMEOUT_MS + 5_000;
    expect(conClaves).toBeLessThanOrEqual(ACTIVATION_TIMEOUT_MS);
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
    // Con `keys`, como una suscripción real. Antes este stub devolvía solo el
    // endpoint, y por eso daba igual que la suscripción estuviera incompleta: los
    // tests daban "hay suscripción" con un objeto que no sirve para enviar nada.
    const getSubscription = jest.fn(async () =>
      subscribed ? { endpoint: 'https://push.test/e', keys: { get: (name: 'p256dh' | 'auth') => name === 'p256dh' ? new TextEncoder().encode('p').buffer : new TextEncoder().encode('a').buffer } } : null,
    );
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
    // Sin esta aserción, este test también pasaría si `isPushSupported`, lo recorta
    // devolviera null antes de preguntar nada, que es como pasó al principio.
    const { getSubscription } = stubBrowser({ subscribed: false });

    await expect(getActiveSubscription()).resolves.toBeNull();
    expect(getSubscription).toHaveBeenCalled();
  });
});


/** Lo justo de Supabase para este bloque: insertar suscripción y anotar motivo. */
function stubDb() {
  const insert = jest.fn(async () => ({ error: null }));
  const deleteEq = jest.fn(async () => ({ error: null }));
  const fromPushLog = jest.fn(async () => ({ error: null }));
  (supabase.from as jest.Mock).mockImplementation((table: string) =>
    table === 'push_subscriptions'
      ? { delete: () => ({ eq: deleteEq }), insert }
      : table === 'push_log'
        ? { insert: fromPushLog }
        : { upsert: jest.fn(async () => ({ error: null })) },
  );
  return { insert, fromPushLog };
}

describe('una suscripción sin claves no cuenta como activa', () => {
  // El defecto medido en un Android real: el navegador devuelve una suscripción
  // con endpoint pero sin `p256dh` ni `auth`. La lectura la contaba como activa,
  // el interruptor decía "activado" y en la base no había ni una fila. Un estado
  // que miente, que además engañó al propio diagnóstico cuando se buscaba la
  // causa de que no llegaran los avisos.
  const originalOs = Platform.OS;
  let pushManager: { getSubscription: jest.Mock; subscribe: jest.Mock };

  beforeEach(() => {
    Platform.OS = 'web';
    jest.useFakeTimers();
    pushManager = { getSubscription: jest.fn(), subscribe: jest.fn() };
    const registration = {
      active: { state: 'activated', addEventListener: jest.fn(), removeEventListener: jest.fn() },
      installing: null,
      waiting: null,
      pushManager,
    };
    Object.assign(global.window, {
      Notification: Object.assign(function Notification() {}, {
        permission: 'granted',
        // Sin esto, `enableWebPush` falla al pedir permiso y nunca llega a la
        // suscripción: el test pasaba por otro motivo del que decía probar.
        requestPermission: jest.fn(async () => 'granted'),
      }),
      PushManager: function PushManager() {},
    });
    Object.assign(global.navigator, {
      serviceWorker: {
        getRegistration: jest.fn(async () => registration),
        register: jest.fn(async () => registration),
        ready: Promise.resolve(registration),
      },
    });
  });

  afterEach(() => {
    Platform.OS = originalOs;
    jest.useRealTimers();
  });

  it('la lectura devuelve null y NO da de baja nada', async () => {
    const unsubscribe = jest.fn(async () => true);
    pushManager.getSubscription.mockResolvedValue({
      endpoint: 'https://fcm.googleapis.com/fcm/send/sin-claves',
      keys: null,
      unsubscribe,
    });

    await expect(getActiveSubscription()).resolves.toBeNull();
    // Y no toca nada. Dar de baja desde una lectura es una carrera: Ajustes lee al
    // montar y al volver del segundo plano, y si pilla la suscripción a medio
    // hacer del alta que ella misma está haciendo, la tira y el alta falla con un
    // motivo inventado. La limpieza va en `subscribeAndStore`, que es secuencial.
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it('un objeto sin método unsubscribe no rompe la lectura', async () => {
    // Este navegador ya ha devuelto objetos a medias. Si puede faltar `keys`, no
    // cuesta nada que un método pueda faltar también: un TypeError aquí caería la
    // lectura que decide si hay algo que limpiar.
    pushManager.getSubscription.mockResolvedValue({ endpoint: 'https://push.test/e', keys: null });

    await expect(getActiveSubscription()).resolves.toBeNull();
  });

  it('una suscripción completa sí cuenta como activa', async () => {
    // El otro lado del contrato: sin esto, el arreglo de arriba podría pasar
    // simplemente deixando de devolver nada nunca.
    pushManager.getSubscription.mockResolvedValue({
      endpoint: 'https://fcm.googleapis.com/fcm/send/buena',
      keys: { get: (name: 'p256dh' | 'auth') => name === 'p256dh' ? new TextEncoder().encode('p').buffer : new TextEncoder().encode('a').buffer },
    });

    await expect(getActiveSubscription()).resolves.toMatchObject({
      endpoint: 'https://fcm.googleapis.com/fcm/send/buena',
    });
  });

  it('espera a que las claves aparezcan antes de declarar la suscripción mala', async () => {
    jest.useFakeTimers();
    // Chrome genera `p256dh` y `auth` de forma asíncrona, después de crear la
    // suscripción. Leerla en el acto la encuentra sin claves aunque las vaya a
    // tener: medido en un Android real, seis intentos seguidos fallaron así.
    const unsubscribe = jest.fn(async () => true);
    const db = stubDb();
    let conClaves = false;
    setTimeout(() => {
      conClaves = true;
    }, 1000);
    // Un único objeto, como en el navegador: `getSubscription()` devuelve la
    // misma suscripción y lo que cambia son sus `keys`. Con dos objetos
    // distintos, el que trae las claves no tenía `unsubscribe` y una baja de más
    // sobre él pasaba inadvertida.
    const suscripcion = { endpoint: 'https://push.test/e', keys: null as { p256dh: string; auth: string } | null, unsubscribe };
    suscripcion.keys = { p256dh: 'p', auth: 'a' };
    pushManager.getSubscription.mockImplementation(async () => {
      suscripcion.keys = conClaves ? { p256dh: 'p', auth: 'a' } : null;
      return suscripcion;
    });
    pushManager.subscribe.mockResolvedValue(suscripcion);

    const promesa = enableWebPush({ id: 'user-1' } as never);
    await jest.advanceTimersByTimeAsync(35_000);
    const result = await promesa;
    jest.useRealTimers();

    expect(result.status).toBe('enabled');
    // Y se guarda **la** que trae las claves, no la que se creó a medias. Sin esto,
    // un mutante que devolviera las claves bien y aun así diera de baja la
    // suscripción nueva pasaría: `status` seguiría siendo `enabled` y el insert
    // seguiría llamándose, con el navegador sin nada y la base diciendo que sí.
    expect(db.insert).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://push.test/e', active: true }),
    );
    // Una sola baja, y es la de siempre: la suscripción que ya había y venía sin
    // claves, que se limpia antes de pedir otra. Lo que se prueba es que la
    // suscripción nueva, que sí tiene claves, NO se da de baja. Sin la espera se
    // habría declarado mala y el alta habría fallado.
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('la espera termina aunque la lectura se quede colgada', async () => {
    jest.useFakeTimers();
    // El invariante del módulo: nada se cuelga sin techo. Se comprueba con las dos
    // protecciones a la vez, porque cada una tapa un agujero distinto: el tope por
    // lectura evita que un `getSubscription()` que no resuelve deje la espera
    // viva, y el de iteraciones evita que un bucle se realimente sin fin.
    // Sin cualquiera de las dos, esta prueba no termina.
    const unsubscribe = jest.fn(async () => true);
    stubDb();
    let lecturas = 0;
    pushManager.getSubscription.mockImplementation(() => {
      lecturas += 1;
      return new Promise<PushSubscription>(() => {
        /* nunca resuelve: la lectura se queda colgada */
      });
    });
    pushManager.subscribe.mockResolvedValue({ endpoint: 'https://push.test/e', keys: null, unsubscribe });

    const promesa = enableWebPush({ id: 'user-1' } as never);
    await jest.advanceTimersByTimeAsync(35_000);
    const result = await promesa;
    jest.useRealTimers();

    // Termina, que es lo importante. Y con un veredicto concreto en vez de
    // colgarse: la suscripción volvió sin claves y no se pudo volver a leer, así
    // que lo honesto es decir que el navegador no dio las claves.
    expect(result.status).toBe('failed');

    // Y el bucle está acotado, no solo el flujo. Sin el tope de iteraciones el
    // resultado sería el mismo ('timeout', por el tope exterior) pero el trabajo
    // seguiría creciendo sin fin por debajo, y eso no se ve desde fuera.
    const maxLecturas = Math.ceil(CLAVES_TIMEOUT_MS / CLAVES_PASO_MS) + 3;
    expect(lecturas).toBeLessThanOrEqual(maxLecturas);
  });

  it('una consulta de registro colgada no deja el alta esperando', async () => {
    jest.useFakeTimers();
    // La usan la lectura, el alta y la baja. Sin tope, un `getRegistration()` que
    // no resuelve deja el alta entera esperando el corte exterior, con el trabajo
    // siguiendo por debajo: exactamente lo que la cabecera del módulo promete que
    // no pasa.
    stubDb();
    pushManager.subscribe.mockResolvedValue({ endpoint: 'https://push.test/e', keys: { get: (name: 'p256dh' | 'auth') => name === 'p256dh' ? new TextEncoder().encode('p').buffer : new TextEncoder().encode('a').buffer } });
    (global.navigator as unknown as { serviceWorker: { getRegistration: jest.Mock } }).serviceWorker.getRegistration =
      jest.fn(() => new Promise(() => {
        /* nunca resuelve */
      }));

    const promesa = enableWebPush({ id: 'user-1' } as never);
    await jest.advanceTimersByTimeAsync(SW_READY_TIMEOUT_MS + 1000);
    const result = await promesa;
    jest.useRealTimers();

    // Termina con un motivo, no colgada.
    expect(result.status).not.toBe('enabled');
  });

  it('la baja de la suscripción tampoco se queda colgada', async () => {
    // `unsubscribe()` no es local: el navegador puede hablar con su servicio de
    // push. Con la red caída no resuelve, y sin tope el alta entera se quedaba
    // esperando sin mensaje.
    const unsubscribe = jest.fn(() => new Promise<boolean>(() => {
      /* nunca resuelve */
    }));
    stubDb();
    pushManager.getSubscription.mockResolvedValue(null);
    pushManager.subscribe.mockResolvedValue({ endpoint: 'https://push.test/e', keys: null, unsubscribe });

    const promesa = enableWebPush({ id: 'user-1' } as never);
    await jest.advanceTimersByTimeAsync(30_000);
    const result = await promesa;

    expect(result.status).toBe('failed');
  });

  it('un error de verdad en la espera no se reintenta ni se disfraza de "sin claves"', async () => {
    // Reintentar un `InvalidStateError` no lo arregla: el worker caído no se
    // levanta insistir. Y si al final se informara de "el navegador no ha dado
    // las claves", la persona acabaría en los servicios de Google Play cuando el
    // problema es otro. Es el mismo defecto que causó el bug original: un motivo
    // que manda por el camino equivocado.
    const unsubscribe = jest.fn(async () => true);
    const db = stubDb();
    let lecturas = 0;
    pushManager.getSubscription.mockImplementation(() => {
      lecturas += 1;
      return Promise.reject(new Error('el worker se ha caído'));
    });
    pushManager.subscribe.mockResolvedValue({ endpoint: 'https://push.test/e', keys: null, unsubscribe });

    const promesa = enableWebPush({ id: 'user-1' } as never);
    await jest.advanceTimersByTimeAsync(2000);
    const result = await promesa;

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      // Ni "sin claves" (mandaría a mirar Play Services cuando el problema es
      // otro) ni el texto crudo del navegador (un motivo que nadie puede usar).
      expect(result.reason).not.toMatch(/claves de cifrado/i);
      expect(result.reason).toBe(SUBSCRIBE_FAILURE_MESSAGES['desconocido']);
    }
    // Y el motivo queda anotado, que es lo que permite leerlo después sin
    // depender de que alguien describa lo que vio en el alert.
    expect(db.fromPushLog).toHaveBeenCalled();
    // Y sin insistir: dos lecturas, no seis. La primera es la que se hace antes de
    // pedir una suscripción nueva, y ahí el error sí se enmascara a propósito:
    // esa lectura solo sirve para limpiar una suscripción vieja, así que lo
    // razonable es seguir adelante y dejar que el alta de verdad diga qué pasa.
    expect(lecturas).toBe(2);
  });

  it('si las claves no llegan, da de baja la suscripción y anota el motivo', async () => {
    const unsubscribe = jest.fn(async () => true);
    const db = stubDb();
    // `getSubscription()` devuelve null a propósito: no hay suscripción previa que
    // limpiar, así que la única llamada a `unsubscribe` que puede ocurrir es la
    // nueva, sobre la suscripción que acaba de devolver `subscribe()` sin claves.
    // Con una suscripción previa, la daba de baja el camino viejo y el test pasaba
    // aunque el nuevo se borrara.
    pushManager.getSubscription.mockResolvedValue(null);
    pushManager.subscribe.mockResolvedValue({ endpoint: 'https://push.test/e', keys: null, unsubscribe });

    const promesa = enableWebPush({ id: 'user-1' } as never);
    await jest.advanceTimersByTimeAsync(4000);
    const result = await promesa;

    expect(result.status).toBe('failed');
    // La baja es lo nuevo: antes se dejaba viva y el navegador la devolvía en
    // cada intento posterior, con lo que un fallo se repetía indefinidamente.
    expect(unsubscribe).toHaveBeenCalled();
    expect(db.fromPushLog).toHaveBeenCalled();
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
      keys: { get: (name: 'p256dh' | 'auth') => name === 'p256dh' ? new TextEncoder().encode('p').buffer : new TextEncoder().encode('a').buffer },
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

    // `failed` diría "algo ha fallado"; `timeout` dice que se quedó esperando.
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
      existing: { endpoint: 'https://push.test/vieja', keys: { get: () => null } },
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
      existing: { endpoint: 'https://push.test/buena', keys: { get: (name: 'p256dh' | 'auth') => name === 'p256dh' ? new TextEncoder().encode('p').buffer : new TextEncoder().encode('a').buffer }, unsubscribe: jest.fn() },
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
    const mockGetAuthMissing = jest.fn((name: 'p256dh' | 'auth') => (name === 'p256dh' ? new TextEncoder().encode('p').buffer : null));
    expect(incompleteReason({ endpoint: 'https://e', keys: { get: mockGetAuthMissing } })).toBe('sin-auth');
    const mockGetP256dhMissing = jest.fn((name: 'p256dh' | 'auth') => (name === 'auth' ? new TextEncoder().encode('a').buffer : null));
    expect(incompleteReason({ endpoint: 'https://e', keys: { get: mockGetP256dhMissing } })).toBe('sin-p256dh');
    expect(incompleteReason({ endpoint: null, keys: { get: () => new TextEncoder().encode('p').buffer } })).toBe('sin-endpoint');
    const mockGetAll = jest.fn((name: 'p256dh' | 'auth') => new TextEncoder().encode(name === 'p256dh' ? 'p' : 'a').buffer);
    expect(incompleteReason({ endpoint: 'https://e', keys: { get: mockGetAll } })).toBeNull();
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
      subscribe: async () => ({ endpoint: 'https://e', keys: { get: (name: 'p256dh' | 'auth') => name === 'p256dh' ? new TextEncoder().encode('p').buffer : null } }),
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
    // El síntoma sería "no ha terminado a tiempo" en lugar de "Play Services",
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
      existing: { endpoint: 'https://push.test/buena', keys: { get: (name: 'p256dh' | 'auth') => name === 'p256dh' ? new TextEncoder().encode('p').buffer : new TextEncoder().encode('a').buffer }, unsubscribe: jest.fn() },
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
  // es el mismo objeto que se devuelve, para poder comprobar sobre el.
  function stubBrowser(existing?: unknown) {
    const subscription = {
      endpoint: 'https://push.test/e',
      keys: { get: (name: 'p256dh' | 'auth') => name === 'p256dh' ? new TextEncoder().encode('p').buffer : new TextEncoder().encode('a').buffer },
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
    stubDb({ deleteError: { message: 'violación de políticas' } });
    stubBrowser();

    const result = await disableWebPush(user);

    expect(result).toEqual({ status: 'failed', reason: 'violación de políticas' });
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

describe('getStoredBirthdayChoice: leer lo que se guardó', () => {
  // La fila de `push_preferences` se escribía bien y no la leía nadie: el
  // selector de Ajustes arrancaba siempre en "sin aviso" en web. Estos tests
  // cubren los seis finales que puede tener esa lectura, incluido el que la deja
  // inservible sin que nadie lo note.
  const user = { id: 'user-1' } as unknown as Parameters<typeof getStoredBirthdayChoice>[0];

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  /** Lo justo de Supabase para leer la preferencia: `select` → `eq` → `maybeSingle`. */
  function stubPrefs(
    result:
      | { data: { birthday_choice: string } | null; error: { message: string } | null }
      // Una petición que no responde nunca, que es lo que corta el tope.
      | 'colgado',
  ) {
    const maybeSingle = jest.fn(() =>
      result === 'colgado'
        ? new Promise<never>(() => undefined)
        : Promise.resolve(result),
    );
    const eq = jest.fn(() => ({ maybeSingle }));
    const select = jest.fn(() => ({ eq }));
    const from = jest.fn((table: string) =>
      table === 'push_preferences' ? { select } : { upsert: jest.fn() },
    );
    (supabase.from as jest.Mock).mockImplementation(from);
    return { from, select, eq, maybeSingle };
  }

  it('devuelve lo que hay en la fila, filtrando por usuario', async () => {
    const db = stubPrefs({ data: { birthday_choice: 'day-before' }, error: null });

    await expect(getStoredBirthdayChoice(user)).resolves.toBe('day-before');
    // El filtro va aunque la RLS ya lo imponga: documenta que solo se lee la fila
    // propia y no depende de que esa política siga siendo la de `auth.uid()`.
    expect(db.select).toHaveBeenCalledWith('birthday_choice');
    expect(db.eq).toHaveBeenCalledWith('user_id', 'user-1');
  });

  it('acepta los cuatro valores de la lista compartida, no una copia', async () => {
    // Si alguien añade un valor a `reminderChoices` y esta lectura valida contra
    // una lista propia, el selector no podría mostrarlo: se quedaría en "sin
    // aviso" con el valor escrito y guardado. El bucle ata las dos listas.
    for (const value of reminderChoices) {
      stubPrefs({ data: { birthday_choice: value }, error: null });
      await expect(getStoredBirthdayChoice(user)).resolves.toBe(value);
    }
  });

  it('sin fila devuelve sin aviso', async () => {
    stubPrefs({ data: null, error: null });

    await expect(getStoredBirthdayChoice(user)).resolves.toBe('none');
  });

  it('un valor que no es de la lista cae a sin aviso', async () => {
    // La columna es `text` con un `check` en la base, pero el cliente no puede
    // fiarse de que la fila la escribiera esta versión del código. Un valor
    // inesperado tiene que llegar al selector como algo elegible, no como texto
    // suelto que no casa con ningún chip.
    for (const basura of ['', 'cada-dos-dias', 'Both', 'null']) {
      stubPrefs({ data: { birthday_choice: basura }, error: null });
      await expect(getStoredBirthdayChoice(user)).resolves.toBe('none');
    }
  });

  it('sin sesión no pregunta nada a la base', async () => {
    const db = stubPrefs({ data: { birthday_choice: 'both' }, error: null });

    await expect(getStoredBirthdayChoice(null)).resolves.toBe('none');
    expect(db.from).not.toHaveBeenCalled();
  });

  it('un error de la base no se propaga y tampoco se traga en silencio', async () => {
    stubPrefs({ data: null, error: { message: 'fallo de red' } });

    // No rechaza: Ajustes no tiene dónde mostrar un motivo, y un rechazo ahí
    // dejaba el interruptor deshabilitado hasta recargar la página.
    await expect(getStoredBirthdayChoice(user)).resolves.toBe('none');
    // El motivo sí se anota. Un "sin aviso" silencioso es justo lo que hace
    // invisible que la lectura falle, que es como nació este bug.
    expect(console.warn).toHaveBeenCalledWith(
      'No se pudo leer la preferencia de cumpleaños guardada',
      'fallo de red',
    );
  });

  it('una lectura que no responde se corta con el tope', async () => {
    // Sin este tope, Ajustes esperaba la respuesta antes de habilitar el
    // interruptor y un TCP colgado lo dejaba bloqueado hasta recargar.
    jest.useFakeTimers();
    stubPrefs('colgado');

    const promise = getStoredBirthdayChoice(user);
    await jest.advanceTimersByTimeAsync(PREFS_READ_TIMEOUT_MS);

    await expect(promise).resolves.toBe('none');
    expect(console.warn).toHaveBeenCalledWith(
      'No se pudo leer la preferencia de cumpleaños guardada',
      expect.stringContaining('no ha terminado a tiempo'),
    );
  });

  it('lee la misma columna que escribe syncPushPreferences', async () => {
    // El bug era un par desparejo: una escritura sin lectura. Este test ata las
    // dos mitades, que es lo que las dejó separarse sin que nada se enterara.
    const upsert = jest.fn(async () => ({ error: null }));
    (supabase.from as jest.Mock).mockImplementation((table: string) =>
      table === 'push_preferences' ? { upsert } : {},
    );
    await syncPushPreferences(user, { birthdayChoice: 'same-day' });

    expect(upsert).toHaveBeenCalledWith(
      { user_id: 'user-1', birthday_choice: 'same-day' },
      { onConflict: 'user_id' },
    );
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
    // otra vez y vuelve a fallar.
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

describe('la clave VAPID del frontend', () => {
  it('es una clave publica P-256 utilizable por el navegador', () => {
    const bytes = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(4);
  });

  it('es un punto real de la curva P-256, no solo 65 bytes que empiezan por 0x04', () => {
    // El fallo historico de esta clave fue una que cumplia los dos requisitos
    // de tamano y prefijo y aun asi no era un punto de la curva. Un test que
    // fija un literal solo sabe decir si el literal sigue ahi, no si la clave
    // significa nada. Esto se comprueba con la ecuacion de la curva sobre el primo
    // de NIST: y^2 == x^3 + ax + b (mod p). Sobrevive a cualquier rotacion.
    const bytes = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    const P = 2n ** 256n - 2n ** 224n + 2n ** 192n + 2n ** 96n - 1n;
    const A = -3n;
    const B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;
    const x = BigInt('0x' + Buffer.from(bytes.subarray(1, 33)).toString('hex'));
    const y = BigInt('0x' + Buffer.from(bytes.subarray(33, 65)).toString('hex'));

    const mod = (v: bigint) => ((v % P) + P) % P;
    expect(mod(y * y)).toBe(mod(x * x * x + A * x + B));
  });

  it('es la clave que rotamos en el PR #73, y no la anterior', () => {
    // Con la clave anterior, el navegador Chrome 153 devolvia una suscripcion con
    // endpoint pero sin `p256dh` ni `auth`, seis veces seguidas. Ese par en
    // concreto esta en la base, en el Vault, y esta en el bundle. Si alguien
    // cambia una de las tres sin cambiar las otras dos, los avisos dejan de
    // firmarse en silencio: es exactamente el fallo que se midio.
    expect(VAPID_PUBLIC_KEY).toBe(
      'BHJV5jOQoaXKdrI90Z7O-7tYh29DANfUB7jSMS8w3M_szTkpfCXaQx7uzoW5IixMuaCHmKJeVvW4Cz_oHaUpmrg',
    );
    // Y la anterior no puede volver a colarse.
    expect(VAPID_PUBLIC_KEY).not.toMatch(/^BGAx5MQzNUhQM9/);
  });
});
