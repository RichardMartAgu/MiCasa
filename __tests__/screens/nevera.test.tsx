import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, Platform } from 'react-native';

import NeveraScreen from '@/app/(tabs)/nevera';
import { startOfDay, toISODate } from '@/lib/date';
import type { FridgeItem } from '@/lib/types';

const mockDateTimePickerAndroidOpen = jest.fn();
jest.mock('@react-native-community/datetimepicker', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: function MockPicker() {
      return <View testID="date-picker" />;
    },
    DateTimePickerAndroid: {
      open: (...args: unknown[]) => mockDateTimePickerAndroidOpen(...args),
    },
  };
});

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => <Text>{name}</Text>,
  };
});

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  Redirect: () => null,
}));

const mockUseAuth = jest.fn();
jest.mock('@/context/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockUseCasa = jest.fn();
jest.mock('@/context/casa-context', () => ({
  useCasa: () => mockUseCasa(),
}));

const mockUseRealtimeCollection = jest.fn();
jest.mock('@/hooks/use-realtime-collection', () => ({
  useRealtimeCollection: (...args: unknown[]) => mockUseRealtimeCollection(...args),
}));

const mockAddFridgeItem = jest.fn();
const mockUpdateFridgeItem = jest.fn();
const mockRemoveFridgeItem = jest.fn();
const mockToggleFridgeItem = jest.fn();
jest.mock('@/lib/api', () => ({
  addFridgeItem: (...args: unknown[]) => mockAddFridgeItem(...args),
  fetchFridgeItems: jest.fn(),
  removeFridgeItem: (...args: unknown[]) => mockRemoveFridgeItem(...args),
  toggleFridgeItem: (...args: unknown[]) => mockToggleFridgeItem(...args),
  updateFridgeItem: (...args: unknown[]) => mockUpdateFridgeItem(...args),
}));

const mockConfirmDialog = jest.fn();
jest.mock('@/lib/confirm', () => ({
  confirmDialog: (...args: unknown[]) => mockConfirmDialog(...args),
}));

const mockGetFridgeChoice = jest.fn();
const mockScheduleFridgeItem = jest.fn();
const mockCancelEntityKey = jest.fn();
jest.mock('@/lib/notifications', () => ({
  getFridgeChoice: (...args: unknown[]) => mockGetFridgeChoice(...args),
  scheduleFridgeItem: (...args: unknown[]) => mockScheduleFridgeItem(...args),
  cancelEntityKey: (...args: unknown[]) => mockCancelEntityKey(...args),
}));

const mockValidateTitle = jest.fn();
jest.mock('@/lib/validation', () => ({
  validateTitle: (...args: unknown[]) => mockValidateTitle(...args),
}));

const casa = { id: 'c1', name: 'Mi Hogar', invite_code: 'ABCD1234' };
const user = { id: 'u1' };

const today = new Date();
function isoInDays(days: number): string {
  const date = new Date(today);
  date.setDate(date.getDate() + days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const milk: FridgeItem = {
  id: 'f1',
  casa_id: 'c1',
  user_id: 'u1',
  name: 'Leche',
  expiry_date: isoInDays(1),
  notify_audience: 'me',
  quantity: 2,
  unit: 'L',
  done: false,
  created_at: '2026-10-01',
};

const yogurt: FridgeItem = {
  ...milk,
  id: 'f2',
  name: 'Yogur',
  expiry_date: isoInDays(-1),
  quantity: null,
  unit: null,
  done: false,
};

function setup(items: FridgeItem[] = [milk, yogurt]) {
  mockUseAuth.mockReturnValue({ user });
  mockUseCasa.mockReturnValue({ currentCasa: casa, loading: false });
  mockUseRealtimeCollection.mockReturnValue({ data: items, loading: false, error: null, reload: jest.fn() });
  return render(<NeveraScreen />);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockValidateTitle.mockReturnValue({ valid: true });
  mockConfirmDialog.mockResolvedValue(true);
  mockGetFridgeChoice.mockResolvedValue('both');
  mockAddFridgeItem.mockResolvedValue({ error: null, data: milk });
  mockUpdateFridgeItem.mockResolvedValue({ error: null, data: milk });
  mockToggleFridgeItem.mockResolvedValue(null);
  mockRemoveFridgeItem.mockResolvedValue(null);
  mockScheduleFridgeItem.mockResolvedValue(undefined);
  mockCancelEntityKey.mockResolvedValue(undefined);
});

describe('NeveraScreen', () => {
  it('muestra título y productos ordenados', () => {
    const { getByText } = setup();
    expect(getByText('Nevera')).toBeTruthy();
    expect(getByText('Leche')).toBeTruthy();
    expect(getByText('Caduca mañana')).toBeTruthy();
    expect(getByText('Caducó ayer')).toBeTruthy();
  });

  it('muestra estado vacío', () => {
    const { getByText } = setup([]);
    expect(getByText('No hay elementos en la nevera')).toBeTruthy();
  });

  it('crea un producto y lo programa en nativo', async () => {
    const { getByText, getByLabelText, getAllByDisplayValue } = setup([]);
    fireEvent.press(getByLabelText('Añadir producto a la nevera'));
    await waitFor(() => expect(getByText('Nuevo producto')).toBeTruthy());

    const [nameInput] = getAllByDisplayValue('');
    fireEvent.changeText(nameInput, 'Leche');
    fireEvent.press(getByText('Añadir'));

    await waitFor(() => {
      expect(mockAddFridgeItem).toHaveBeenCalledWith(
        expect.objectContaining({ casa_id: 'c1', name: 'Leche' }),
      );
      expect(mockScheduleFridgeItem).toHaveBeenCalledWith(milk, 'both', 'u1');
    });
  });

  it('permite elegir una caducidad futura distinta de hoy', async () => {
    const original = Platform.OS;
    Platform.OS = 'android';
    try {
      const { getByText, getByLabelText, getAllByDisplayValue } = setup([]);
      fireEvent.press(getByLabelText('Añadir producto a la nevera'));
      await waitFor(() => expect(getByText('Nuevo producto')).toBeTruthy());

      fireEvent.press(getByLabelText(/Fecha de caducidad:/));
      expect(mockDateTimePickerAndroidOpen).toHaveBeenCalledTimes(1);
      const openArgs = mockDateTimePickerAndroidOpen.mock.calls[0][0] as {
        minimumDate: Date;
        onChange: (event: { type: string }, date?: Date) => void;
      };
      expect(openArgs.minimumDate).toEqual(startOfDay(new Date()));

      const future = new Date();
      future.setDate(future.getDate() + 10);
      act(() => openArgs.onChange({ type: 'set' }, future));

      const [nameInput] = getAllByDisplayValue('');
      fireEvent.changeText(nameInput, 'Leche');
      fireEvent.press(getByText('Añadir'));

      await waitFor(() => {
        expect(mockAddFridgeItem).toHaveBeenCalledWith(
          expect.objectContaining({ expiry_date: toISODate(future) }),
        );
      });
    } finally {
      Platform.OS = original;
    }
  });

  it('permite guardar hoy como caducidad', async () => {
    const original = Platform.OS;
    Platform.OS = 'android';
    try {
      const { getByText, getByLabelText, getAllByDisplayValue } = setup([]);
      fireEvent.press(getByLabelText('Añadir producto a la nevera'));
      await waitFor(() => expect(getByText('Nuevo producto')).toBeTruthy());

      fireEvent.press(getByLabelText(/Fecha de caducidad:/));
      const openArgs = mockDateTimePickerAndroidOpen.mock.calls[0][0] as {
        onChange: (event: { type: string }, date?: Date) => void;
      };
      act(() => openArgs.onChange({ type: 'set' }, new Date()));

      const [nameInput] = getAllByDisplayValue('');
      fireEvent.changeText(nameInput, 'Leche');
      fireEvent.press(getByText('Añadir'));

      await waitFor(() => {
        expect(mockAddFridgeItem).toHaveBeenCalledWith(
          expect.objectContaining({ expiry_date: toISODate(new Date()) }),
        );
      });
    } finally {
      Platform.OS = original;
    }
  });

  it('guarda la audiencia elegida al crear producto', async () => {
    const { getByText, getByLabelText, getAllByDisplayValue } = setup([]);
    fireEvent.press(getByLabelText('Añadir producto a la nevera'));
    await waitFor(() => expect(getByText('Nuevo producto')).toBeTruthy());

    expect(getByText('Solo yo')).toBeTruthy();
    fireEvent.press(getByText('Toda la casa'));
    const [nameInput] = getAllByDisplayValue('');
    fireEvent.changeText(nameInput, 'Leche');
    fireEvent.press(getByText('Añadir'));

    await waitFor(() => {
      expect(mockAddFridgeItem).toHaveBeenCalledWith(
        expect.objectContaining({ notify_audience: 'all' }),
      );
    });
  });

  it('valida el nombre antes de guardar', async () => {
    mockValidateTitle.mockReturnValue({ valid: false, message: 'El título es obligatorio.' });
    const { getByText, getByLabelText } = setup([]);
    fireEvent.press(getByLabelText('Añadir producto a la nevera'));
    fireEvent.press(getByText('Añadir'));

    await waitFor(() => expect(getByText('El título es obligatorio.')).toBeTruthy());
    expect(mockAddFridgeItem).not.toHaveBeenCalled();
  });

  it('muestra Alert si guardar falla', async () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockAddFridgeItem.mockResolvedValue({ error: { message: 'sin red' }, data: undefined });
    const { getByText, getByLabelText, getAllByDisplayValue } = setup([]);
    fireEvent.press(getByLabelText('Añadir producto a la nevera'));
    const [nameInput] = getAllByDisplayValue('');
    fireEvent.changeText(nameInput, 'Leche');
    fireEvent.press(getByText('Añadir'));

    await waitFor(() => expect(spy).toHaveBeenCalledWith('Error', 'sin red'));
  });

  it('marca consumido y cancela el aviso', async () => {
    const { getAllByLabelText } = setup([milk]);
    fireEvent.press(getAllByLabelText('Marcar Leche como consumido')[0]);
    await waitFor(() => {
      expect(mockToggleFridgeItem).toHaveBeenCalledWith('f1', true);
      expect(mockCancelEntityKey).toHaveBeenCalledWith('fridge', 'f1');
    });
  });

  it('edita un producto', async () => {
    const { getAllByText, getByText, getAllByDisplayValue } = setup([milk]);
    fireEvent.press(getAllByText('Leche')[0]);
    await waitFor(() => expect(getByText('Editar producto')).toBeTruthy());

    const [nameInput] = getAllByDisplayValue('Leche');
    fireEvent.changeText(nameInput, 'Leche entera');
    fireEvent.press(getByText('Guardar'));

    await waitFor(() =>
      expect(mockUpdateFridgeItem).toHaveBeenCalledWith(
        'f1',
        expect.objectContaining({ name: 'Leche entera' }),
      ),
    );
  });

  it('elimina tras confirmar y cancela el aviso', async () => {
    const { getAllByLabelText } = setup([milk]);
    fireEvent.press(getAllByLabelText('Eliminar Leche')[0]);
    await waitFor(() => {
      expect(mockRemoveFridgeItem).toHaveBeenCalledWith('f1');
      expect(mockCancelEntityKey).toHaveBeenCalledWith('fridge', 'f1');
    });
  });

  it('al editar un consumido no programa avisos y cancela los viejos', async () => {
    mockUpdateFridgeItem.mockResolvedValue({
      error: null,
      data: { ...milk, name: 'Leche entera', done: true },
    });
    const { getAllByText, getByText, getAllByDisplayValue } = setup([{ ...milk, done: true }]);
    fireEvent.press(getAllByText('Leche')[0]);
    await waitFor(() => expect(getByText('Editar producto')).toBeTruthy());
    const [nameInput] = getAllByDisplayValue('Leche');
    fireEvent.changeText(nameInput, 'Leche entera');
    fireEvent.press(getByText('Guardar'));
    await waitFor(() => {
      expect(mockUpdateFridgeItem).toHaveBeenCalled();
      expect(mockScheduleFridgeItem).not.toHaveBeenCalled();
      expect(mockCancelEntityKey).toHaveBeenCalledWith('fridge', 'f1');
    });
  });

  it('no elimina si se cancela', async () => {
    mockConfirmDialog.mockResolvedValue(false);
    const { getAllByLabelText } = setup([milk]);
    fireEvent.press(getAllByLabelText('Eliminar Leche')[0]);
    await waitFor(() => expect(mockConfirmDialog).toHaveBeenCalled());
    expect(mockRemoveFridgeItem).not.toHaveBeenCalled();
  });

  it('en web no programa notificación local', async () => {
    const original = Platform.OS;
    Platform.OS = 'web';
    try {
      const { getByText, getByLabelText, getAllByDisplayValue } = setup([]);
      fireEvent.press(getByLabelText('Añadir producto a la nevera'));
      const [nameInput] = getAllByDisplayValue('');
      fireEvent.changeText(nameInput, 'Leche');
      fireEvent.press(getByText('Añadir'));
      await waitFor(() => expect(mockAddFridgeItem).toHaveBeenCalled());
      expect(mockScheduleFridgeItem).not.toHaveBeenCalled();
    } finally {
      Platform.OS = original;
    }
  });
});
