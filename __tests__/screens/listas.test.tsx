import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import ListasScreen from '@/app/(tabs)/listas';
import type { ShoppingItem, ShoppingList } from '@/lib/types';

jest.mock('@react-native-community/datetimepicker', () => {
  const { View } = require('react-native');
  return function MockPicker() {
    return <View testID="date-picker" />;
  };
});

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => <Text>{name}</Text>,
  };
});

const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ navigate: mockNavigate }),
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

const mockAddShoppingList = jest.fn();
const mockAddShoppingItem = jest.fn();
jest.mock('@/lib/api', () => ({
  addShoppingItem: (...args: unknown[]) => mockAddShoppingItem(...args),
  addShoppingList: (...args: unknown[]) => mockAddShoppingList(...args),
  fetchShoppingItems: jest.fn(),
  fetchShoppingLists: jest.fn(),
  removeShoppingItem: jest.fn().mockResolvedValue(null),
  removeShoppingList: jest.fn().mockResolvedValue(null),
  toggleShoppingItem: jest.fn().mockResolvedValue(null),
  toggleShoppingList: jest.fn().mockResolvedValue(null),
}));

const mockValidateTitle = jest.fn();
jest.mock('@/lib/validation', () => ({
  validateTitle: (...args: unknown[]) => mockValidateTitle(...args),
}));

const casa = { id: 'c1', name: 'Mi Hogar', invite_code: 'ABCD1234' };
const user = { id: 'u1' };
const list: ShoppingList = {
  id: 'l1',
  casa_id: 'c1',
  user_id: 'u1',
  title: 'Frutas',
  done: false,
  created_at: '2026-09-01',
};
const item: ShoppingItem = {
  id: 'i1',
  list_id: 'l1',
  name: 'Leche',
  quantity: 2,
  unit: 'L',
  done: false,
  created_at: '2026-09-01',
};

function setup(
  lists: ShoppingList[] = [],
  items: ShoppingItem[] = [],
  currentCasa = casa,
) {
  mockUseAuth.mockReturnValue({ user });
  mockUseCasa.mockReturnValue({ currentCasa });
  mockUseRealtimeCollection.mockImplementation((_fetchFn: unknown, table: string) =>
    table === 'shopping_lists'
      ? { data: lists, loading: false, error: null, reload: jest.fn() }
      : { data: items, loading: false, error: null, reload: jest.fn() },
  );
  return render(<ListasScreen />);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAddShoppingList.mockResolvedValue(null);
  mockAddShoppingItem.mockResolvedValue(null);
  mockValidateTitle.mockReturnValue({ valid: true });
});

describe('ListasScreen', () => {
  it('renderiza título y subtítulo', () => {
    const { getByText } = setup([list], [item]);
    expect(getByText('Listas de la compra')).toBeTruthy();
    expect(getByText('1 listas abiertas')).toBeTruthy();
  });

  it('muestra EmptyState sin listas', () => {
    const { getByText } = setup([], []);
    expect(getByText('Sin listas todavía')).toBeTruthy();
  });

  it('muestra listas con conteo de artículos', () => {
    const { getByText } = setup([list], [item]);
    expect(getByText('Frutas')).toBeTruthy();
    expect(getByText('0/1 artículos')).toBeTruthy();
  });

  it('abre modal y crea lista nueva', async () => {
    const { getByText, getAllByDisplayValue } = setup([], []);

    fireEvent.press(getByText('add'));
    await waitFor(() => {
      expect(getByText('Nueva lista')).toBeTruthy();
    });

    const [titleInput] = getAllByDisplayValue('');
    fireEvent.changeText(titleInput, 'Farmacia');
    fireEvent.press(getByText('Crear'));

    await waitFor(() => {
      expect(mockAddShoppingList).toHaveBeenCalledWith(
        expect.objectContaining({
          casa_id: 'c1',
          user_id: 'u1',
          title: 'Farmacia',
        }),
      );
    });
  });

  it('muestra errores de validación al crear lista', async () => {
    mockValidateTitle.mockReturnValue({
      valid: false,
      message: 'El título es obligatorio.',
    });
    const { getByText } = setup([], []);

    fireEvent.press(getByText('add'));
    await waitFor(() => {
      expect(getByText('Nueva lista')).toBeTruthy();
    });

    fireEvent.press(getByText('Crear'));

    await waitFor(() => {
      expect(getByText('El título es obligatorio.')).toBeTruthy();
    });
    expect(mockAddShoppingList).not.toHaveBeenCalled();
  });

  it('muestra Alert si addShoppingList falla', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockAddShoppingList.mockResolvedValue({
      message: 'Problema de conexión. Inténtalo de nuevo.',
    });
    const { getByText, getAllByDisplayValue } = setup([], []);

    fireEvent.press(getByText('add'));
    await waitFor(() => expect(getByText('Nueva lista')).toBeTruthy());

    const [titleInput] = getAllByDisplayValue('');
    fireEvent.changeText(titleInput, 'Farmacia');
    fireEvent.press(getByText('Crear'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Error',
        'Problema de conexión. Inténtalo de nuevo.',
      );
    });
    alertSpy.mockRestore();
  });

  it('expande lista y añade artículo', async () => {
    const { getByText, getAllByDisplayValue, getAllByText } = setup([list], [item]);

    fireEvent.press(getByText('Frutas'));
    await waitFor(() => {
      expect(getByText(/Leche/)).toBeTruthy();
    });

    const [nameInput, qtyInput] = getAllByDisplayValue('');
    fireEvent.changeText(nameInput, 'Manzanas');
    fireEvent.changeText(qtyInput, '3');

    const addButtons = getAllByText('add');
    fireEvent.press(addButtons[addButtons.length - 1]);

    await waitFor(() => {
      expect(mockAddShoppingItem).toHaveBeenCalledWith(
        expect.objectContaining({
          list_id: 'l1',
          name: 'Manzanas',
          quantity: 3,
        }),
      );
    });
  });

  it('muestra aviso de crear casa cuando no hay casa', () => {
    mockUseCasa.mockReturnValue({ currentCasa: null, loading: false });
    const { getByText } = render(<ListasScreen />);
    expect(getByText('Crea una casa primero')).toBeTruthy();
    expect(getByText('Ir a Ajustes')).toBeTruthy();
  });
});