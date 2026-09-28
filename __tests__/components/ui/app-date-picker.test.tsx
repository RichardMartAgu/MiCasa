import { act, fireEvent, render } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { AppDatePicker } from '@/components/ui/app-date-picker';

const mockDateTimePickerAndroidOpen = jest.fn();
jest.mock('@react-native-community/datetimepicker', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: function MockPicker() {
      return <View testID="mock-picker" />;
    },
    DateTimePickerAndroid: {
      open: (...args: unknown[]) => mockDateTimePickerAndroidOpen(...args),
    },
  };
});

function renderDatePicker(onChange = jest.fn()) {
  return render(
    <AppDatePicker
      value={new Date(2026, 8, 21)}
      mode="date"
      icon="📅"
      formatValue={(d) => d.toLocaleDateString('es-ES')}
      accessibilityLabel="Cambiar fecha"
      onChange={onChange}
    />,
  );
}

describe('AppDatePicker (nativo)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('en Android abre DateTimePickerAndroid.open con mode date e is24Hour', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const onChange = jest.fn();
    const { getByLabelText } = renderDatePicker(onChange);

    fireEvent.press(getByLabelText('Cambiar fecha'));

    expect(mockDateTimePickerAndroidOpen).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'date', is24Hour: true }),
    );
    const openArgs = mockDateTimePickerAndroidOpen.mock.calls[0][0] as {
      onChange?: (event: { type: string }, date?: Date) => void;
    };
    act(() => {
      openArgs.onChange?.({ type: 'set' }, new Date(2026, 9, 1));
    });
    expect(onChange).toHaveBeenCalledWith(new Date(2026, 9, 1));
  });

  it('en Android abre DateTimePickerAndroid.open con mode time', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const onChange = jest.fn();
    const { getByLabelText } = render(
      <AppDatePicker
        value={new Date(2026, 8, 21, 9, 30)}
        mode="time"
        icon="🕐"
        formatValue={(d) => d.toLocaleTimeString('es-ES')}
        accessibilityLabel="Cambiar hora"
        onChange={onChange}
      />,
    );

    fireEvent.press(getByLabelText('Cambiar hora'));

    expect(mockDateTimePickerAndroidOpen).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'time', is24Hour: true }),
    );
  });

  it('en Android ignora evento dismissed', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const onChange = jest.fn();
    const { getByLabelText } = renderDatePicker(onChange);

    fireEvent.press(getByLabelText('Cambiar fecha'));

    const openArgs = mockDateTimePickerAndroidOpen.mock.calls[0][0] as {
      onChange?: (event: { type: string }, date?: Date) => void;
    };
    act(() => {
      openArgs.onChange?.({ type: 'dismissed' }, new Date(2026, 9, 1));
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('en iOS alterna picker inline sin llamar a open', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const { getByLabelText, getByTestId, queryByTestId } = renderDatePicker();

    expect(queryByTestId('mock-picker')).toBeNull();
    fireEvent.press(getByLabelText('Cambiar fecha'));
    expect(getByTestId('mock-picker')).toBeTruthy();
    expect(mockDateTimePickerAndroidOpen).not.toHaveBeenCalled();
  });
});