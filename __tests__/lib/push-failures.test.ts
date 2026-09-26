import {
  classifySubscribeFailure,
  SUBSCRIBE_FAILURE_MESSAGES,
  type SubscribeFailure,
} from '@/lib/push-failures';

/**
 * Estos casos salen de un Chromium real y de los nombres de DOM, que son
 * estándar. Los textos de Chrome cambian entre versiones, así que la
 * clasificación se decide por el nombre del error: si se decidiera por el texto,
 * un cambio de versión de Chrome haría que el motivo fuera "desconocido".
 */

const err = (name: string, message = ''): Error => {
  const e = new Error(message);
  e.name = name;
  return e;
};

describe('classifySubscribeFailure', () => {
  it('traduce el AbortError real de Chrome a falta de servicio push', () => {
    // Medido: `AbortError: Registration failed - push service not available`.
    expect(classifySubscribeFailure(err('AbortError', 'Registration failed - push service not available'))).toBe(
      'sin-servicio-push',
    );
  });

  it('no se fía del texto cuando el nombre ya lo dice', () => {
    // El mismo fallo con un texto que no es el de Chrome.
    expect(classifySubscribeFailure(err('AbortError', 'lo que sea'))).toBe('sin-servicio-push');
  });

  it('con el permiso denegado, el motivo es el permiso aunque el error sea AbortError', () => {
    // Medido: con el permiso ya denegado, Chrome devuelve AbortError y no lo
    // dice. Sin mirar el permiso se le manda a alguien a tocar Play Services
    // cuando lo que tiene es el permiso bloqueado en el navegador.
    expect(classifySubscribeFailure(err('AbortError', 'push service not available'), 'denied')).toBe(
      'permiso',
    );
  });

  it('con el permiso concedido y AbortError, la culpa es del servicio push', () => {
    expect(classifySubscribeFailure(err('AbortError', 'push service not available'), 'granted')).toBe(
      'sin-servicio-push',
    );
  });

  it('NotAllowedError es permiso, tenga el texto que tenga', () => {
    expect(classifySubscribeFailure(err('NotAllowedError', 'Permission denied'), 'default')).toBe('permiso');
  });

  it('un error sin nombre propio pero con "permission" en el texto es permiso', () => {
    // Forma real: hay navegadores que no ponen el nombre en `name` y lo dejan
    // dentro del texto ("AbortError: permission denied"). Sin esta rama, eso se
    // leería como un fallo del servicio de push.
    expect(classifySubscribeFailure(err('Error', 'AbortError: permission denied'), 'granted')).toBe(
      'permiso',
    );
  });

  it('InvalidStateError es el service worker, no el móvil', () => {
    expect(classifySubscribeFailure(err('InvalidStateError'))).toBe('worker-inactivo');
  });

  it('un TypeError con la clave de aplicación es bug nuestro y se dice', () => {
    expect(classifySubscribeFailure(err('TypeError', 'applicationServerKey'))).toBe('clave-invalida');
  });

  it('un TypeError pelado también se atribuye a la configuración', () => {
    expect(classifySubscribeFailure(err('TypeError', 'x'))).toBe('clave-invalida');
  });

  it('lo que no se reconoce es desconocido, y no se inventa un motivo', () => {
    expect(classifySubscribeFailure(err('WeirdError'))).toBe('desconocido');
    expect(classifySubscribeFailure('nada')).toBe('desconocido');
    expect(classifySubscribeFailure(undefined)).toBe('desconocido');
  });

  it('un error sin nombre pero con el texto del servicio push también se reconoce', () => {
    expect(classifySubscribeFailure(new Error('Registration failed - push service not available'))).toBe(
      'sin-servicio-push',
    );
  });
});

describe('SUBSCRIBE_FAILURE_MESSAGES', () => {
  const motivos: SubscribeFailure[] = [
    'sin-servicio-push',
    'permiso',
    'worker-inactivo',
    'clave-invalida',
    'desconocido',
  ];

  it('tiene un motivo legible para cada motivo posible', () => {
    for (const m of motivos) {
      expect(typeof SUBSCRIBE_FAILURE_MESSAGES[m]).toBe('string');
      expect(SUBSCRIBE_FAILURE_MESSAGES[m].length).toBeGreaterThan(20);
    }
  });

  it('ningún motivo se queda con el texto del navegador en inglés', () => {
    for (const m of motivos) {
      const texto = SUBSCRIBE_FAILURE_MESSAGES[m];
      expect(texto).not.toMatch(/Registration failed/i);
      expect(texto).not.toMatch(/push service not available/i);
      expect(texto).toMatch(/[áéíóúñ¿¡]/i);
    }
  });

  it('el de Play Services menciona los servicios de Google, que es la causa típica', () => {
    // Sin esto, el mensaje dice "no se ha podido" y no dice qué hacer.
    expect(SUBSCRIBE_FAILURE_MESSAGES['sin-servicio-push']).toMatch(/Play/);
  });

  it('el de clave inválida dice que es problema nuestro, para no culpar al móvil', () => {
    expect(SUBSCRIBE_FAILURE_MESSAGES['clave-invalida']).toMatch(/nuestro/i);
  });
});
