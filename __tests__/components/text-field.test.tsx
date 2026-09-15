import { fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { TextField } from '@/components/ui/text-field';

describe('TextField', () => {
  it('expone el label como accessibilityLabel del input', () => {
    const { getByLabelText } = render(
      <TextField label="Correo" value="" onChangeText={jest.fn()} />,
    );
    expect(getByLabelText('Correo')).toBeTruthy();
  });

  it('renderiza label y valor', () => {
    const { getByText, getByDisplayValue } = render(
      <TextField label="Correo" value="ana@casa.com" onChangeText={jest.fn()} />,
    );
    expect(getByText('Correo')).toBeTruthy();
    expect(getByDisplayValue('ana@casa.com')).toBeTruthy();
  });

  it('propaga onChangeText', () => {
    const onChangeText = jest.fn();
    const { getByDisplayValue } = render(
      <TextField label="Correo" value="" onChangeText={onChangeText} />,
    );

    fireEvent.changeText(getByDisplayValue(''), 'ana@casa.com');
    expect(onChangeText).toHaveBeenCalledWith('ana@casa.com');
  });

  it('muestra mensaje de error', () => {
    const { getByText } = render(
      <TextField label="Correo" value="" onChangeText={jest.fn()} error="El correo es obligatorio." />,
    );
    expect(getByText('El correo es obligatorio.')).toBeTruthy();
  });

  it('no muestra error cuando no hay', () => {
    const { queryByText } = render(
      <TextField label="Correo" value="" onChangeText={jest.fn()} />,
    );
    expect(queryByText('El correo es obligatorio.')).toBeNull();
  });

  it('propaga secureTextEntry', () => {
    const { getByDisplayValue } = render(
      <TextField label="Contraseña" value="123" onChangeText={jest.fn()} secureTextEntry />,
    );
    expect(getByDisplayValue('123').props.secureTextEntry).toBe(true);
  });

  it('renderiza toggle cuando secureTextEntry está activo', () => {
    const { getByLabelText } = render(
      <TextField label="Contraseña" value="123" onChangeText={jest.fn()} secureTextEntry />,
    );
    expect(getByLabelText('Mostrar contraseña')).toBeTruthy();
  });

  it('no renderiza toggle sin secureTextEntry', () => {
    const { queryByLabelText } = render(
      <TextField label="Correo" value="" onChangeText={jest.fn()} />,
    );
    expect(queryByLabelText('Mostrar contraseña')).toBeNull();
  });

  it('no renderiza toggle con secureTextEntry={false} explícito', () => {
    const { queryByLabelText, getByDisplayValue } = render(
      <TextField label="Contraseña" value="123" onChangeText={jest.fn()} secureTextEntry={false} />,
    );
    expect(queryByLabelText('Mostrar contraseña')).toBeNull();
    expect(getByDisplayValue('123').props.secureTextEntry).toBeFalsy();
  });

  it('toggle muestra y oculta la contraseña', () => {
    const { getByLabelText, getByDisplayValue } = render(
      <TextField label="Contraseña" value="123" onChangeText={jest.fn()} secureTextEntry />,
    );
    const input = getByDisplayValue('123');
    expect(input.props.secureTextEntry).toBe(true);

    fireEvent.press(getByLabelText('Mostrar contraseña'));
    expect(getByDisplayValue('123').props.secureTextEntry).toBe(false);
    expect(getByLabelText('Ocultar contraseña')).toBeTruthy();

    fireEvent.press(getByLabelText('Ocultar contraseña'));
    expect(getByDisplayValue('123').props.secureTextEntry).toBe(true);
    expect(getByLabelText('Mostrar contraseña')).toBeTruthy();
  });

  it('toggle gana sobre rightIcon manual con secureTextEntry', () => {
    const { getByLabelText, queryByTestId } = render(
      <TextField
        label="Contraseña"
        value="123"
        onChangeText={jest.fn()}
        secureTextEntry
        rightIcon={<Text testID="right-icon">R</Text>}
      />,
    );
    expect(getByLabelText('Mostrar contraseña')).toBeTruthy();
    expect(queryByTestId('right-icon')).toBeNull();
  });

  it('renderiza leftIcon y rightIcon', () => {
    const { getByTestId } = render(
      <TextField
        label="Correo"
        value=""
        onChangeText={jest.fn()}
        leftIcon={<Text testID="left-icon">L</Text>}
        rightIcon={<Text testID="right-icon">R</Text>}
      />,
    );
    expect(getByTestId('left-icon')).toBeTruthy();
    expect(getByTestId('right-icon')).toBeTruthy();
  });
});