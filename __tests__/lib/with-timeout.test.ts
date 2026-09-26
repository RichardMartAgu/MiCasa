import { isTimeout, TimeoutError, withTimeout } from '@/lib/with-timeout';

describe('withTimeout', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('devuelve el valor si la operación gana al tope', async () => {
    await expect(withTimeout(Promise.resolve('listo'), 50, 'tarde')).resolves.toBe('listo');
  });

  it('propaga el fallo original sin tocarlo', async () => {
    const boom = new Error('sin red');
    await expect(withTimeout(Promise.reject(boom), 50, 'tarde')).rejects.toBe(boom);
  });

  it('rechaza con el motivo dado cuando la operación no termina nunca', async () => {
    jest.useFakeTimers();
    const colgada = new Promise<string>(() => {});
    const promesa = withTimeout(colgada, 30_000, 'el navegador no respondió');

    jest.advanceTimersByTime(30_000);

    await expect(promesa).rejects.toThrow('el navegador no respondió');
  });

  it('el rechazo del tope es distinguible de un fallo normal', async () => {
    jest.useFakeTimers();
    const promesa = withTimeout(new Promise<string>(() => {}), 1000, 'tarde');

    jest.advanceTimersByTime(1000);

    await promesa.catch((error: unknown) => {
      expect(isTimeout(error)).toBe(true);
      expect(error).toBeInstanceOf(TimeoutError);
      expect(isTimeout(new Error('sin red'))).toBe(false);
    });
  });

  it('deja el temporizador vivo solo mientras espera', async () => {
    jest.useFakeTimers();

    await withTimeout(Promise.resolve('listo'), 30_000, 'tarde');
    expect(jest.getTimerCount()).toBe(0);

    // Sin esta limpieza, un temporizador de 30 s pendiente mantendría vivo el
    // proceso de Node al terminar los tests.
    const fallida = withTimeout(Promise.reject(new Error('sin red')), 30_000, 'tarde');
    await expect(fallida).rejects.toThrow('sin red');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('no espera más de lo pactado aunque la operación llegue tarde', async () => {
    jest.useFakeTimers();
    const lenta = new Promise<string>((resolve) => {
      setTimeout(() => resolve('tarde'), 60_000);
    });

    const promesa = withTimeout(lenta, 1000, 'tarde');
    jest.advanceTimersByTime(1000);
    await expect(promesa).rejects.toThrow('tarde');

    // La operación de fondo no se cancela: sigue resolviendo, y su valor ya no
    // tiene a nadie esperando.
    jest.advanceTimersByTime(60_000);
    await expect(lenta).resolves.toBe('tarde');
  });
});
