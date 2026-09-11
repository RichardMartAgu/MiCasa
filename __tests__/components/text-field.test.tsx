import { fireEvent, render } from '@testing-library/react-native';

import { TextField } from '@/components/ui/text-field';

describe('TextField', () => {
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
});