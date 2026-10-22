import { fireEvent, render } from '@testing-library/react-native';

import { AppDatePicker } from '@/components/ui/app-date-picker/index.web';
import {
  openNativePicker,
  parseDateInput,
  parseTimeInput,
  toDateInputValue,
  toTimeInputValue,
} from '@/components/ui/app-date-picker/index.web';

describe('AppDatePicker web', () => {
  const originalNavigator = globalThis.navigator;
  beforeEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
        maxTouchPoints: 5,
      },
    });
  });
  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator,
    });
  });

  it('muestra un botón accesible con la fecha formateada', () => {
    const { getByLabelText, getByText } = render(
      <AppDatePicker
        value={new Date(2026, 8, 21)}
        mode="date"
        icon="📅"
        formatValue={toDateInputValue}
        accessibilityLabel="Cambiar fecha"
        onChange={jest.fn()}
      />,
    );

    expect(getByText('📅 2026-09-21')).toBeTruthy();
    expect(getByLabelText('Cambiar fecha').props.accessibilityRole).toBe('button');
  });

  it('emite onChange al elegir fecha y pulsar Listo', () => {
    const onChange = jest.fn();
    const { getByLabelText, getByText } = render(
      <AppDatePicker
        value={new Date(2026, 8, 21)}
        mode="date"
        icon="📅"
        formatValue={toDateInputValue}
        accessibilityLabel="Cambiar fecha"
        onChange={onChange}
      />,
    );

    fireEvent.press(getByLabelText('Cambiar fecha'));
    fireEvent(getByLabelText('Día'), 'change', { target: { value: '1' } });
    fireEvent(getByLabelText('Mes'), 'change', { target: { value: '10' } });
    fireEvent(getByLabelText('Año'), 'change', { target: { value: '2027' } });
    fireEvent.press(getByText('Listo'));

    expect(onChange).toHaveBeenCalledWith(new Date(2027, 10, 1));
  });

  it('emite onChange al elegir hora y pulsar Listo', () => {
    const onChange = jest.fn();
    const base = new Date(2026, 8, 21, 8, 15);
    const { getByLabelText, getByText } = render(
      <AppDatePicker
        value={base}
        mode="time"
        icon="🕐"
        formatValue={toTimeInputValue}
        accessibilityLabel="Cambiar hora"
        onChange={onChange}
      />,
    );

    fireEvent.press(getByLabelText('Cambiar hora'));
    fireEvent(getByLabelText('Hora'), 'change', { target: { value: '17' } });
    fireEvent(getByLabelText('Minuto'), 'change', { target: { value: '45' } });
    fireEvent.press(getByText('Listo'));

    expect(onChange).toHaveBeenCalledWith(new Date(2026, 8, 21, 17, 45));
  });

  it('no emite si se cancela', () => {
    const onChange = jest.fn();
    const { getByLabelText, getByText } = render(
      <AppDatePicker
        value={new Date(2026, 8, 21)}
        mode="date"
        icon="📅"
        formatValue={toDateInputValue}
        accessibilityLabel="Cambiar fecha"
        onChange={onChange}
      />,
    );

    fireEvent.press(getByLabelText('Cambiar fecha'));
    fireEvent(getByLabelText('Día'), 'change', { target: { value: '1' } });
    fireEvent.press(getByText('Cancelar'));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('no mueve una fecha fuera de rango si no se toca', () => {
    const onChange = jest.fn();
    const { getByLabelText, getByText } = render(
      <AppDatePicker
        value={new Date(2020, 0, 1)}
        mode="date"
        icon="📅"
        formatValue={toDateInputValue}
        accessibilityLabel="Cambiar fecha"
        onChange={onChange}
        min={new Date(2026, 9, 21)}
      />,
    );

    fireEvent.press(getByLabelText('Cambiar fecha'));
    fireEvent.press(getByText('Listo'));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('clampa el día al cambiar a un mes más corto', () => {
    const { getByLabelText } = render(
      <AppDatePicker
        value={new Date(2026, 0, 31)}
        mode="date"
        icon="📅"
        formatValue={toDateInputValue}
        accessibilityLabel="Cambiar fecha"
        onChange={jest.fn()}
      />,
    );

    fireEvent.press(getByLabelText('Cambiar fecha'));
    fireEvent(getByLabelText('Mes'), 'change', { target: { value: '1' } });

    expect(getByLabelText('Día').props.value).toBe('28');
  });

  it('respeta min al confirmar', () => {
    const onChange = jest.fn();
    const { getByLabelText, getByText } = render(
      <AppDatePicker
        value={new Date(2026, 8, 21)}
        mode="date"
        icon="📅"
        formatValue={toDateInputValue}
        accessibilityLabel="Cambiar fecha"
        onChange={onChange}
        min={new Date(2026, 8, 30)}
      />,
    );

    fireEvent.press(getByLabelText('Cambiar fecha'));
    fireEvent(getByLabelText('Día'), 'change', { target: { value: '29' } });
    fireEvent.press(getByText('Listo'));

    expect(onChange).toHaveBeenCalledWith(new Date(2026, 8, 30));
  });

  it('respeta max al confirmar', () => {
    const onChange = jest.fn();
    const { getByLabelText, getByText } = render(
      <AppDatePicker
        value={new Date(2026, 8, 21)}
        mode="date"
        icon="📅"
        formatValue={toDateInputValue}
        accessibilityLabel="Cambiar fecha"
        onChange={onChange}
        max={new Date(2026, 8, 30)}
      />,
    );

    fireEvent.press(getByLabelText('Cambiar fecha'));
    fireEvent(getByLabelText('Mes'), 'change', { target: { value: '10' } });
    fireEvent.press(getByText('Listo'));

    expect(onChange).toHaveBeenCalledWith(new Date(2026, 8, 30));
  });

  it('no reemite si se confirma sin cambios', () => {
    const onChange = jest.fn();
    const { getByLabelText, getByText } = render(
      <AppDatePicker
        value={new Date(2026, 8, 21)}
        mode="date"
        icon="📅"
        formatValue={toDateInputValue}
        accessibilityLabel="Cambiar fecha"
        onChange={onChange}
      />,
    );

    fireEvent.press(getByLabelText('Cambiar fecha'));
    fireEvent.press(getByText('Listo'));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('clampa min en el input nativo de Android', () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        userAgent:
          'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/140.0 Mobile',
        maxTouchPoints: 5,
      },
    });
    const onChange = jest.fn();
    const { getByTestId } = render(
      <AppDatePicker
        value={new Date(2026, 8, 21)}
        mode="date"
        icon="📅"
        formatValue={toDateInputValue}
        accessibilityLabel="Cambiar fecha"
        onChange={onChange}
        min={new Date(2026, 8, 30)}
      />,
    );

    fireEvent(getByTestId('date-picker-input', { includeHiddenElements: true }), 'change', {
      target: { value: '2026-09-25' },
    });

    expect(onChange).toHaveBeenCalledWith(new Date(2026, 8, 30));
  });

  it('ignora min y max en el input nativo de hora', () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        userAgent:
          'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/140.0 Mobile',
        maxTouchPoints: 5,
      },
    });
    const { getByTestId } = render(
      <AppDatePicker
        value={new Date(2026, 8, 21, 8, 15)}
        mode="time"
        icon="🕐"
        formatValue={toTimeInputValue}
        accessibilityLabel="Cambiar hora"
        onChange={jest.fn()}
        min={new Date(2026, 8, 21)}
        max={new Date(2026, 8, 21, 23, 59)}
      />,
    );

    const input = getByTestId('date-picker-input', { includeHiddenElements: true });
    expect(input.props.min).toBeUndefined();
    expect(input.props.max).toBeUndefined();
  });

  it('emite al cambiar la hora en el input nativo de Android', () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        userAgent:
          'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/140.0 Mobile',
        maxTouchPoints: 5,
      },
    });
    const onChange = jest.fn();
    const { getByTestId } = render(
      <AppDatePicker
        value={new Date(2026, 8, 21, 8, 15)}
        mode="time"
        icon="🕐"
        formatValue={toTimeInputValue}
        accessibilityLabel="Cambiar hora"
        onChange={onChange}
      />,
    );

    fireEvent(getByTestId('date-picker-input', { includeHiddenElements: true }), 'change', {
      target: { value: '17:45' },
    });

    expect(onChange).toHaveBeenCalledWith(new Date(2026, 8, 21, 17, 45));
  });

  it('no clampa al hacer blur sin cambio en nativo', () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        userAgent:
          'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/140.0 Mobile',
        maxTouchPoints: 5,
      },
    });
    const onChange = jest.fn();
    const { getByTestId } = render(
      <AppDatePicker
        value={new Date(2020, 0, 1)}
        mode="date"
        icon="📅"
        formatValue={toDateInputValue}
        accessibilityLabel="Cambiar fecha"
        onChange={onChange}
        min={new Date(2026, 9, 21)}
      />,
    );

    fireEvent(getByTestId('date-picker-input', { includeHiddenElements: true }), 'blur', {
      target: { value: '2020-01-01' },
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('ignora min y max en modo hora custom', () => {
    const onChange = jest.fn();
    const { getByLabelText, getByText } = render(
      <AppDatePicker
        value={new Date(2026, 8, 21, 8, 15)}
        mode="time"
        icon="🕐"
        formatValue={toTimeInputValue}
        accessibilityLabel="Cambiar hora"
        onChange={onChange}
        min={new Date(2026, 8, 21, 12, 0)}
        max={new Date(2026, 8, 21, 23, 59)}
      />,
    );

    fireEvent.press(getByLabelText('Cambiar hora'));
    fireEvent(getByLabelText('Hora'), 'change', { target: { value: '9' } });
    fireEvent.press(getByText('Listo'));

    expect(onChange).toHaveBeenCalledWith(new Date(2026, 8, 21, 9, 15));
  });

  it('trata iPadOS de escritorio como iOS', () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 },
    });
    const { getByLabelText } = render(
      <AppDatePicker
        value={new Date(2026, 8, 21)}
        mode="date"
        icon="📅"
        formatValue={toDateInputValue}
        accessibilityLabel="Cambiar fecha"
        onChange={jest.fn()}
      />,
    );

    fireEvent.press(getByLabelText('Cambiar fecha'));
    expect(getByLabelText('Día')).toBeTruthy();
  });

  it('abre el picker nativo al pulsar el botón', () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        userAgent:
          'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/140.0 Mobile',
        maxTouchPoints: 5,
      },
    });
    const showPicker = jest.fn();
    const { getByLabelText } = render(
      <AppDatePicker
        value={new Date(2026, 8, 21)}
        mode="date"
        icon="📅"
        formatValue={toDateInputValue}
        accessibilityLabel="Cambiar fecha"
        onChange={jest.fn()}
      />,
      {
        createNodeMock: (element) => {
          const props = element.props as { 'data-micasa-date-picker'?: string };
          return props['data-micasa-date-picker']
            ? { showPicker, focus: jest.fn(), click: jest.fn() }
            : null;
        },
      },
    );

    const button = getByLabelText('Cambiar fecha');
    expect(button.props.accessibilityRole).toBe('button');
    fireEvent.press(button);

    expect(showPicker).toHaveBeenCalledTimes(1);
  });

  it('mantiene el input nativo en macOS sin táctil', () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 },
    });
    const { getByTestId } = render(
      <AppDatePicker
        value={new Date(2026, 8, 21)}
        mode="date"
        icon="📅"
        formatValue={toDateInputValue}
        accessibilityLabel="Cambiar fecha"
        onChange={jest.fn()}
      />,
    );

    expect(getByTestId('date-picker-input', { includeHiddenElements: true }).props.type).toBe('date');
  });

  it('usa el input nativo en Android/Chrome', () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        userAgent:
          'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/140.0 Mobile',
        maxTouchPoints: 5,
      },
    });
    const onChange = jest.fn();
    const { getByTestId, queryByText } = render(
      <AppDatePicker
        value={new Date(2026, 8, 21)}
        mode="date"
        icon="📅"
        formatValue={toDateInputValue}
        accessibilityLabel="Cambiar fecha"
        onChange={onChange}
      />,
    );

    const input = getByTestId('date-picker-input', { includeHiddenElements: true });
    expect(input.props.type).toBe('date');
    expect(queryByText('Listo')).toBeNull();

    fireEvent(input, 'change', { target: { value: '2026-10-01' } });
    expect(onChange).toHaveBeenCalledWith(new Date(2026, 9, 1));
  });

  it('toDateInputValue formatea YYYY-MM-DD local', () => {
    expect(toDateInputValue(new Date(2026, 8, 5))).toBe('2026-09-05');
  });

  it('toTimeInputValue formatea HH:mm local', () => {
    expect(toTimeInputValue(new Date(2026, 8, 5, 9, 7))).toBe('09:07');
  });

  it('parseDateInput convierte a Date local sin shift UTC', () => {
    const date = parseDateInput('2026-09-05');
    expect(date).not.toBeNull();
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(8);
    expect(date?.getDate()).toBe(5);
    expect(date?.getHours()).toBe(0);
  });

  it('parseDateInput rechaza input inválido', () => {
    expect(parseDateInput('')).toBeNull();
    expect(parseDateInput('2026-13-01')).toBeNull();
    expect(parseDateInput('2026-09-32')).toBeNull();
    expect(parseDateInput('2026-09')).toBeNull();
    expect(parseDateInput('abc')).toBeNull();
    expect(parseDateInput('1899-09-05')).toBeNull();
    expect(parseDateInput('2101-09-05')).toBeNull();
    expect(parseDateInput('2026-00-05')).toBeNull();
    expect(parseDateInput('2026-09-00')).toBeNull();
    expect(parseDateInput('2026-02-31')).toBeNull();
    expect(parseDateInput('2026-04-31')).toBeNull();
    expect(parseDateInput('2026-09-05-extra')).toBeNull();
  });

  it('parseTimeInput copia horas/minutos preservando fecha base', () => {
    const base = new Date(2026, 8, 21, 8, 15);
    const time = parseTimeInput('17:45', base);
    expect(time).not.toBeNull();
    expect(time?.getFullYear()).toBe(2026);
    expect(time?.getMonth()).toBe(8);
    expect(time?.getDate()).toBe(21);
    expect(time?.getHours()).toBe(17);
    expect(time?.getMinutes()).toBe(45);
  });

  it('parseTimeInput rechaza horas/minutos fuera de rango', () => {
    const base = new Date(2026, 8, 21);
    expect(parseTimeInput('24:00', base)).toBeNull();
    expect(parseTimeInput('12:60', base)).toBeNull();
    expect(parseTimeInput('-1:30', base)).toBeNull();
    expect(parseTimeInput('12:-1', base)).toBeNull();
    expect(parseTimeInput('12', base)).toBeNull();
    expect(parseTimeInput('abc', base)).toBeNull();
    expect(parseTimeInput('12:30:45', base)).toBeNull();
  });

  it('abre el picker nativo con showPicker()', () => {
    const showPicker = jest.fn();
    const focus = jest.fn();
    const click = jest.fn();

    openNativePicker({ showPicker, focus, click } as unknown as HTMLInputElement);

    expect(showPicker).toHaveBeenCalledTimes(1);
    expect(focus).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it('cae a focus y click si showPicker() no está disponible', () => {
    const focus = jest.fn();
    const click = jest.fn();

    openNativePicker({ focus, click } as unknown as HTMLInputElement);

    expect(focus).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('cae a focus y click si showPicker() lanza', () => {
    const showPicker = jest.fn(() => {
      throw new Error('NotAllowedError');
    });
    const focus = jest.fn();
    const click = jest.fn();

    openNativePicker({ showPicker, focus, click } as unknown as HTMLInputElement);

    expect(focus).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
  });
});
