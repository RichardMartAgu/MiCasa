import { fireEvent, render } from '@testing-library/react-native';

import { AppDatePicker } from '@/components/ui/app-date-picker/index.web';
import {
  parseDateInput,
  parseTimeInput,
  toDateInputValue,
  toTimeInputValue,
} from '@/components/ui/app-date-picker/index.web';

describe('AppDatePicker web', () => {
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