import { fireEvent, render } from '@testing-library/react-native';

import { Button } from '@/components/ui/button';

describe('Button', () => {
  it('renderiza el título', () => {
    const { getByText } = render(<Button title="Entrar" />);
    expect(getByText('Entrar')).toBeTruthy();
  });

  it('expone accessibilityRole de botón', () => {
    const { getByRole } = render(<Button title="Entrar" />);
    expect(getByRole('button')).toBeTruthy();
  });

  it('llama onPress al pulsar', () => {
    const onPress = jest.fn();
    const { getByRole } = render(<Button title="Entrar" onPress={onPress} />);

    fireEvent.press(getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('muestra indicador de carga en vez del título', () => {
    const { queryByText } = render(<Button title="Entrar" loading />);
    expect(queryByText('Entrar')).toBeNull();
  });

  it('no llama onPress cuando loading', () => {
    const onPress = jest.fn();
    const { getByRole } = render(<Button title="Entrar" loading onPress={onPress} />);

    fireEvent.press(getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('no llama onPress cuando disabled', () => {
    const onPress = jest.fn();
    const { getByRole } = render(<Button title="Entrar" disabled onPress={onPress} />);

    fireEvent.press(getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
  });
});