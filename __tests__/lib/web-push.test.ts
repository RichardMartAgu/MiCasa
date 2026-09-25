jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getUser: jest.fn() }, from: jest.fn(), rpc: jest.fn() },
}));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ALLOWED_PUSH_ROUTES,
  detectTimeZone,
  toSubscriptionRecord,
  urlBase64ToUint8Array,
  VAPID_PUBLIC_KEY,
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
