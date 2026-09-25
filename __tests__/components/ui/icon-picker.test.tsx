import { fireEvent, render } from '@testing-library/react-native';
import { Platform, StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { IconPicker, nextIconIndex } from '@/components/ui/icon-picker';
import { Palette } from '@/constants/theme';

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: ({ name }: { name: string }) => <Text>{name}</Text> };
});

const options = [
  { icon: 'medkit-outline', label: 'Salud' },
  { icon: 'school-outline', label: 'Cole' },
  { icon: 'car-outline', label: 'Coche' },
] as const;

function setup(value: (typeof options)[number]['icon'] = 'medkit-outline') {
  const onChange = jest.fn();
  const result = render(
    <IconPicker label="Icono" value={value} options={options} onChange={onChange} />,
  );
  return { ...result, onChange };
}

function pressKey(node: ReactTestInstance, key: string) {
  const preventDefault = jest.fn();
  fireEvent(node, 'keyDown', { nativeEvent: { key }, preventDefault });
  return preventDefault;
}

function flatStyle(node: ReactTestInstance) {
  return StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;
}

beforeEach(() => {
  jest.replaceProperty(Platform, 'OS', 'ios');
});

describe('IconPicker', () => {
  it('expone la etiqueta y un grupo de opciones', () => {
    const { getByText, getByLabelText, getByRole } = setup();
    expect(getByText('Icono')).toBeTruthy();
    expect(getByLabelText('Icono')).toBeTruthy();
    expect(getByRole('radio', { name: 'Salud' })).toBeTruthy();
    expect(getByRole('radio', { name: 'Cole' })).toBeTruthy();
  });

  it('marca la opción seleccionada', () => {
    const { getByRole } = setup();
    expect(getByRole('radio', { name: 'Salud' }).props.accessibilityState.checked).toBe(true);
    expect(getByRole('radio', { name: 'Cole' }).props.accessibilityState.checked).toBe(false);
  });

  it('devuelve el icono elegido al pulsar', () => {
    const { getByRole, onChange } = setup();
    fireEvent.press(getByRole('radio', { name: 'Cole' }));
    expect(onChange).toHaveBeenCalledWith('school-outline');
  });

  it('mantiene el grupo fuera del recorrido de tabulación en nativo', () => {
    const { getByRole } = setup();
    const selected = getByRole('radio', { name: 'Salud' });
    const other = getByRole('radio', { name: 'Cole' });
    expect(selected.props.focusable).toBe(false);
    expect(other.props.onKeyDown).toBeUndefined();
  });
});

describe('IconPicker web', () => {
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'web');
  });

  it('aplica roving tabIndex solo en la opción activa', () => {
    const { getByRole } = setup('school-outline');
    expect(getByRole('radio', { name: 'Salud' }).props.tabIndex).toBe(-1);
    expect(getByRole('radio', { name: 'Cole' }).props.tabIndex).toBe(0);
    expect(getByRole('radio', { name: 'Coche' }).props.tabIndex).toBe(-1);
    expect(getByRole('radio', { name: 'Cole' }).props.focusable).toBe(true);
  });

  it('mueve selección y foco con flechas derecha e izquierda', () => {
    const { getByRole, onChange } = setup();

    const preventDefault = pressKey(getByRole('radio', { name: 'Salud' }), 'ArrowRight');
    expect(onChange).toHaveBeenLastCalledWith('school-outline');
    expect(preventDefault).toHaveBeenCalled();

    pressKey(getByRole('radio', { name: 'Cole' }), 'ArrowLeft');
    expect(onChange).toHaveBeenLastCalledWith('medkit-outline');
  });

  it('navega en vertical y da la vuelta al final', () => {
    const { getByRole, onChange } = setup('car-outline');

    pressKey(getByRole('radio', { name: 'Coche' }), 'ArrowDown');
    expect(onChange).toHaveBeenLastCalledWith('medkit-outline');

    pressKey(getByRole('radio', { name: 'Salud' }), 'ArrowUp');
    expect(onChange).toHaveBeenLastCalledWith('car-outline');
  });

  it('ignora teclas que no son flechas', () => {
    const { getByRole, onChange } = setup();
    const preventDefault = pressKey(getByRole('radio', { name: 'Salud' }), 'Tab');
    expect(onChange).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('muestra anillo de foco visible y lo retira al perder el foco', () => {
    const { getByRole } = setup();
    const node = getByRole('radio', { name: 'Cole' });

    expect(flatStyle(node).borderColor).toBe(Palette.border);

    fireEvent(node, 'focus');
    expect(flatStyle(node).borderColor).toBe(Palette.onPrimary);
    expect(flatStyle(node).borderWidth).toBe(2);

    fireEvent(node, 'blur');
    expect(flatStyle(node).borderColor).toBe(Palette.border);
  });
});

describe('nextIconIndex', () => {
  it('calcula el índice siguiente con vuelta', () => {
    expect(nextIconIndex(0, 1, 3)).toBe(1);
    expect(nextIconIndex(2, 1, 3)).toBe(0);
    expect(nextIconIndex(0, -1, 3)).toBe(2);
  });

  it('normaliza índices fuera de rango y listas vacías', () => {
    expect(nextIconIndex(-1, 1, 3)).toBe(1);
    expect(nextIconIndex(9, 1, 3)).toBe(1);
    expect(nextIconIndex(0, 1, 0)).toBe(-1);
  });
});
