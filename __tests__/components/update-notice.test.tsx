import { fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { UpdateNotice } from '@/components/update-notice';
import { leerPendiente } from '@/lib/sw-update';

jest.mock('@/lib/sw-update', () => ({
  leerPendiente: jest.fn(() => false),
  suscribir: jest.fn((fn: () => void) => {
    fn();
    return () => undefined;
  }),
  vigilarActualizacion: jest.fn(),
  aplicarActualizacion: jest.fn(),
  descartarVersion: jest.fn(),
  setAvisoDeFallo: jest.fn(),
}));

type SwMock = {
  leerPendiente: jest.Mock<boolean, []>;
  vigilarActualizacion: jest.Mock;
  aplicarActualizacion: jest.Mock;
  descartarVersion: jest.Mock;
  setAvisoDeFallo: jest.Mock;
};

const sw = jest.requireMock('@/lib/sw-update') as SwMock;

beforeEach(() => {
  jest.clearAllMocks();
  sw.leerPendiente.mockReturnValue(false);
  Platform.OS = 'web';
});

describe('UpdateNotice', () => {
  it('no se ve si no hay versión nueva', () => {
    render(<UpdateNotice />);
    expect(screen.queryByText('Hay una versión nueva de MiCasa')).toBeNull();
    expect(sw.leerPendiente).toHaveBeenCalled();
  });

  it('avisa y ofrece recargar cuando hay una esperando', () => {
    sw.leerPendiente.mockReturnValue(true);
    render(<UpdateNotice />);
    expect(screen.getByText('Hay una versión nueva de MiCasa')).toBeTruthy();
  });

  it('el botón recarga y avisa de que puede perder lo que se estaba escribiendo', () => {
    // El motivo de que exista: `skipWaiting()` hace que el service worker nuevo
    // tome el control solo, y recargar sin preguntar puede perder un formulario
    // a medio rellenar.
    sw.leerPendiente.mockReturnValue(true);
    render(<UpdateNotice />);
    expect(screen.getByText(/estabas escribiendo algo/)).toBeTruthy();
    fireEvent.press(screen.getByText('Recargar'));
    expect(sw.aplicarActualizacion).toHaveBeenCalled();
  });

  it('en nativo no aparece aunque haya algo pendiente', () => {
    // En nativo no hay service worker: el aviso sería ruido.
    Platform.OS = 'ios';
    sw.leerPendiente.mockReturnValue(true);
    render(<UpdateNotice />);
    expect(screen.queryByText('Hay una versión nueva de MiCasa')).toBeNull();
  });

  it('NO vigila la actualización: el enganche va en el layout raíz', () => {
    // Si el enganche viviera aquí, en login y en registro no existiría este
    // componente, y son las pantallas por las que se entra tras un despliegue.
    // El enganche se comprueba en el layout raíz.
    render(<UpdateNotice />);
    expect(sw.vigilarActualizacion).not.toHaveBeenCalled();
  });

  it('ofrece "Más tarde", que sin él el aviso no tiene salida', () => {
    // El aviso de instalar tiene tres salidas. Este tenía ninguna, y un aviso
    // sin salida es un sitio donde no se puede decir que no.
    sw.leerPendiente.mockReturnValue(true);
    render(<UpdateNotice />);
    fireEvent.press(screen.getByText('Más tarde'));
    expect(sw.descartarVersion).toHaveBeenCalled();
  });
});

describe('sw-update: aplicar, con el flujo nuevo', () => {
  const real = jest.requireActual('@/lib/sw-update') as {
    aplicarActualizacion: () => void;
    resetForTests: () => void;
    suscribir: (fn: () => void) => () => void;
    hayRecargaPedida: () => boolean;
    setAvisoDeFallo: (fn: (m: string) => void) => void;
  };

  const g = global as unknown as { navigator?: unknown; sessionStorage?: unknown };

  beforeEach(() => {
    // Este entorno de test no es jsdom: no hay `navigator` ni `sessionStorage`.
    // Se ponen a mano porque el flujo nuevo depende de los dos: la marca de
    // "recarga pedida" vive en sessionStorage, a propósito, para reconocer un
    // `controllerchange` que llegue de otra pestaña.
    const almacen = new Map<string, string>();
    g.sessionStorage = {
      getItem: (k: string) => almacen.get(k) ?? null,
      setItem: (k: string, v: string) => void almacen.set(k, v),
      removeItem: (k: string) => void almacen.delete(k),
    };
    real.resetForTests();
  });

  afterEach(() => {
    delete g.navigator;
    delete g.sessionStorage;
  });

  it('no recarga por su cuenta: pide la activacion y espera al control', async () => {
    // El punto clave del rediseño. Si recargara aquí, recargaría con el service
    // worker viejo todavia controlando, y se volvería al mismo shell.
    const reload = jest.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });
    const postMessage = jest.fn();
    g.navigator = {
      serviceWorker: { getRegistration: async () => ({ waiting: { postMessage } }) },
    };

    real.aplicarActualizacion();
    // `getRegistration()` es una promesa: el mensaje va un tick después.
    await Promise.resolve();
    await Promise.resolve();

    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reload).not.toHaveBeenCalled();
    // Y deja constancia de que se pidió, para reconocer el `controllerchange`.
    expect(real.hayRecargaPedida()).toBe(true);
  });

  it('si el control no cambia, avisa en vez de fallar en silencio', async () => {
    // El fallo se comprueba por efecto: que el mensaje se enviara no prueba nada,
    // porque se puede perder. Lo único que dice la verdad es si la marca de
    // "recarga pedida" sigue puesta. Sin este aviso, la persona pulsa "Recargar",
    // no ve cambio nenhum y no tiene ninguna señal.
    const avisos: unknown[] = [];
    jest.doMock('@/lib/notice', () => ({ showNotice: (...a: unknown[]) => avisos.push(a) }));
    jest.resetModules();
    const recio = jest.requireActual('@/lib/sw-update') as {
      aplicarActualizacion: () => void;
      resetForTests: () => void;
      hayRecargaPedida: () => boolean;
    };
    recio.resetForTests();
    jest.useFakeTimers();
    g.navigator = {
      serviceWorker: {
        getRegistration: async () => ({ waiting: { postMessage: () => undefined } }),
      },
    };

    recio.aplicarActualizacion();
    await Promise.resolve();
    await Promise.resolve();
    // Ni `controllerchange` ni nada: el control nunca cambia. Es el caso que no
    // cubría la versión anterior, que solo miraba si había worker esperando.
    jest.advanceTimersByTime(3001);

    expect(JSON.stringify(avisos)).toMatch(/No se ha podido recargar/);
    // Y la marca se limpia, para que un `controllerchange` posterior no recargue
    // la página sin que nadie lo haya pedido.
    expect(recio.hayRecargaPedida()).toBe(false);
    jest.useRealTimers();
    jest.dontMock('@/lib/notice');
    jest.resetModules();
  });
});
