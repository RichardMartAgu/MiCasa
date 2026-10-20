import { fireEvent, render } from '@testing-library/react-native';

import { AppDatePicker } from '@/components/ui/app-date-picker/index.web';
import {
  parseDateInput,
  parseTimeInput,
  toDateInputValue,
  toTimeInputValue,
} from '@/components/ui/app-date-picker/index.web';

describe('AppDatePicker web', () => {
  it('monta un input real encima del botón, no uno oculto con opacity 0', () => {
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

    const input = getByLabelText('Cambiar fecha');
    expect(input.props.type).toBe('date');
    expect(input.props['data-micasa-date-picker']).toBe('true');
    expect(input.props.style.position).toBe('absolute');
    expect(input.props.style.background).toBe('transparent');
    expect(input.props.style.opacity).toBeUndefined();
  });

  it('emite onChange al cambiar la fecha', () => {
    const onChange = jest.fn();
    const { getByLabelText } = render(
      <AppDatePicker
        value={new Date(2026, 8, 21)}
        mode="date"
        icon="📅"
        formatValue={toDateInputValue}
        accessibilityLabel="Cambiar fecha"
        onChange={onChange}
      />,
    );

    fireEvent(getByLabelText('Cambiar fecha'), 'change', { target: { value: '2026-10-01' } });

    expect(onChange).toHaveBeenCalledWith(new Date(2026, 9, 1));
  });

  it('emite onChange al cambiar la hora', () => {
    const onChange = jest.fn();
    const base = new Date(2026, 8, 21, 8, 15);
    const { getByLabelText } = render(
      <AppDatePicker
        value={base}
        mode="time"
        icon="🕐"
        formatValue={toTimeInputValue}
        accessibilityLabel="Cambiar hora"
        onChange={onChange}
      />,
    );

    fireEvent(getByLabelText('Cambiar hora'), 'change', { target: { value: '17:45' } });

    expect(onChange).toHaveBeenCalledWith(new Date(2026, 8, 21, 17, 45));
  });

  it('no reemite en blur si el valor no cambió', () => {
    const onChange = jest.fn();
    const { getByLabelText } = render(
      <AppDatePicker
        value={new Date(2026, 8, 21)}
        mode="date"
        icon="📅"
        formatValue={toDateInputValue}
        accessibilityLabel="Cambiar fecha"
        onChange={onChange}
      />,
    );

    fireEvent(getByLabelText('Cambiar fecha'), 'blur', {
      target: { value: '2026-09-21' },
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('emite en blur si el valor cambió', () => {
    const onChange = jest.fn();
    const { getByLabelText } = render(
      <AppDatePicker
        value={new Date(2026, 8, 21)}
        mode="date"
        icon="📅"
        formatValue={toDateInputValue}
        accessibilityLabel="Cambiar fecha"
        onChange={onChange}
      />,
    );

    fireEvent(getByLabelText('Cambiar fecha'), 'blur', {
      target: { value: '2026-10-01' },
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(new Date(2026, 9, 1));
  });

  it('ignora fechas inválidas o vacías', () => {
    const onChange = jest.fn();
    const { getByLabelText } = render(
      <AppDatePicker
        value={new Date(2026, 8, 21)}
        mode="date"
        icon="📅"
        formatValue={toDateInputValue}
        accessibilityLabel="Cambiar fecha"
        onChange={onChange}
      />,
    );
    const input = getByLabelText('Cambiar fecha');

    fireEvent(input, 'change', { target: { value: '2026-02-31' } });
    fireEvent(input, 'change', { target: { value: '' } });
    fireEvent(input, 'blur', { target: { value: 'abc' } });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('no reemite en date si la fecha es la misma aunque cambie la hora', () => {
    const onChange = jest.fn();
    const { getByLabelText } = render(
      <AppDatePicker
        value={new Date(2026, 8, 21, 10, 30)}
        mode="date"
        icon="📅"
        formatValue={toDateInputValue}
        accessibilityLabel="Cambiar fecha"
        onChange={onChange}
      />,
    );

    fireEvent(getByLabelText('Cambiar fecha'), 'blur', {
      target: { value: '2026-09-21' },
    });

    expect(onChange).not.toHaveBeenCalled();
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
});