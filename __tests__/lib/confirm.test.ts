import { Alert, Platform } from 'react-native';

import { confirmDialog } from '@/lib/confirm';

type AlertButton = { text?: string; style?: string; onPress?: () => void };

function buttonsOf(alertSpy: jest.SpyInstance): AlertButton[] {
  return (alertSpy.mock.calls[0][2] as AlertButton[]) ?? [];
}

describe('confirmDialog', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.replaceProperty(Platform, 'OS', 'ios');
    delete (globalThis as { confirm?: unknown }).confirm;
  });

  it('resuelve true al pulsar el botón de confirmar', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const promise = confirmDialog('Eliminar gasto', '¿Seguro?', {
      confirmText: 'Eliminar',
      destructive: true,
    });

    expect(alertSpy).toHaveBeenCalledWith(
      'Eliminar gasto',
      '¿Seguro?',
      expect.arrayContaining([
        { text: 'Cancelar', style: 'cancel', onPress: expect.any(Function) },
        { text: 'Eliminar', style: 'destructive', onPress: expect.any(Function) },
      ]),
    );

    buttonsOf(alertSpy).find((b) => b.text === 'Eliminar')?.onPress?.();
    await expect(promise).resolves.toBe(true);
  });

  it('resuelve false al cancelar', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const promise = confirmDialog('Eliminar gasto', '¿Seguro?');

    buttonsOf(alertSpy).find((b) => b.text === 'Cancelar')?.onPress?.();
    await expect(promise).resolves.toBe(false);
  });

  it('usa window.confirm en web', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const confirmSpy = jest.fn(() => true);
    (globalThis as { confirm?: (message: string) => boolean }).confirm = confirmSpy;

    await expect(confirmDialog('Eliminar gasto', '¿Seguro?')).resolves.toBe(true);
    expect(confirmSpy).toHaveBeenCalledWith('¿Seguro?');
  });
});