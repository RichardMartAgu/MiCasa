import { Alert, Platform } from 'react-native';

import { showNotice } from '@/lib/notice';

describe('showNotice', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.replaceProperty(Platform, 'OS', 'ios');
    delete (globalThis as { alert?: unknown }).alert;
  });

  it('usa Alert.alert con título y mensaje en nativo', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    showNotice('Permiso denegado', 'Actívalo desde los ajustes del sistema.');

    expect(alertSpy).toHaveBeenCalledWith(
      'Permiso denegado',
      'Actívalo desde los ajustes del sistema.',
    );
  });

  it('usa window.alert en web, porque Alert.alert es un no-op ahí', () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const alertWebSpy = jest.fn();
    (globalThis as { alert?: (text: string) => void }).alert = alertWebSpy;

    showNotice('Permiso denegado', 'Actívalo desde los ajustes del navegador.');

    expect(alertWebSpy).toHaveBeenCalledWith('Actívalo desde los ajustes del navegador.');
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('no revienta si el navegador no define alert', () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    expect(() => showNotice('Error', 'No se pudo activar los avisos.')).not.toThrow();
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
