import { useEffect } from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { ErrorBoundary } from '@/components/error-boundary';

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('renderiza children sin error', () => {
    const { getByText } = render(
      <ErrorBoundary>
        <Text> contenido </Text>
      </ErrorBoundary>,
    );
    expect(getByText(' contenido ')).toBeTruthy();
  });

  it('captura error, loguea detalle en consola y muestra UI genérica', () => {
    const Bomb = () => {
      throw new Error('fallo simulado');
    };

    const { getByText, getByRole, getByTestId, queryByText } = render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('[ErrorBoundary]'),
    );
    expect(getByTestId('error-boundary')).toHaveProp(
      'accessibilityRole',
      'alert',
    );
    expect(getByText('Algo salió mal.')).toBeTruthy();
    expect(
      getByText('Intenta de nuevo. Si el problema continúa, revisa la consola.'),
    ).toBeTruthy();
    expect(queryByText('fallo simulado')).toBeNull();
    expect(getByRole('button', { name: 'Reintentar' })).toBeTruthy();
  });

  it('reintentar remonta children limpio (key/attempt)', () => {
    let shouldFail = true;
    let mounts = 0;

    const Flaky = () => {
      useEffect(() => {
        mounts += 1;
      }, []);
      if (shouldFail) throw new Error('fallo');
      return <Text>éxito</Text>;
    };

    const { getByText, getByRole } = render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    );

    expect(getByText('Algo salió mal.')).toBeTruthy();

    shouldFail = false;
    fireEvent.press(getByRole('button', { name: 'Reintentar' }));

    expect(getByText('éxito')).toBeTruthy();
    expect(mounts).toBe(1);
  });
});