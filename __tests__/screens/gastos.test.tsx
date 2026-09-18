import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import GastosScreen from '@/app/(tabs)/gastos';
import type { Category, Expense } from '@/lib/types';

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

const mockAddExpense = jest.fn();
const mockAddCategory = jest.fn();
const mockRemoveExpense = jest.fn();
jest.mock('@/lib/api', () => ({
  addCategory: (...args: unknown[]) => mockAddCategory(...args),
  addExpense: (...args: unknown[]) => mockAddExpense(...args),
  fetchCategories: jest.fn(),
  fetchExpenses: jest.fn(),
  removeCategory: jest.fn().mockResolvedValue(null),
  removeExpense: (...args: unknown[]) => mockRemoveExpense(...args),
  updateCategory: jest.fn().mockResolvedValue(null),
  updateExpense: jest.fn().mockResolvedValue(null),
}));

const casa = { id: 'c1', name: 'Mi Hogar', invite_code: 'ABCD1234' };
const user = { id: 'u1' };
const category: Category = {
  id: 'cat1',
  casa_id: 'c1',
  name: 'Comida',
  color: '#10b981',
  icon: 'pricetag',
  budget: 200,
  created_at: '2026-01-01',
};
const expense: Expense = {
  id: 'e1',
  casa_id: 'c1',
  user_id: 'u1',
  category_id: 'cat1',
  title: 'Supermercado',
  amount: 45.5,
  spent_at: '2026-09-01T10:00:00',
  note: null,
  created_at: '2026-09-01T10:00:00',
};

function setup(
  expenses: Expense[] = [],
  categories: Category[] = [],
  currentCasa = casa,
) {
  mockUseAuth.mockReturnValue({ user });
  mockUseCasa.mockReturnValue({ currentCasa });
  mockUseRealtimeCollection.mockImplementation((_fetchFn: unknown, table: string) =>
    table === 'expenses'
      ? { data: expenses, loading: false, error: null, reload: jest.fn() }
      : { data: categories, loading: false, error: null, reload: jest.fn() },
  );
  return render(<GastosScreen />);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAddExpense.mockResolvedValue(null);
  mockAddCategory.mockResolvedValue(null);
  mockRemoveExpense.mockResolvedValue(null);
});

describe('GastosScreen', () => {
  it('renderiza título y total del mes', () => {
    const { getByText } = setup([expense], [category]);
    expect(getByText('Gastos')).toBeTruthy();
  });

  it('muestra EmptyState sin gastos', () => {
    const { getByText } = setup([], []);
    expect(getByText('Sin gastos registrados')).toBeTruthy();
  });

  it('muestra categorías con totales', () => {
    const { getAllByText } = setup([expense], [category]);
    expect(getAllByText('Comida')).toHaveLength(2);
  });

  it('excluye gasto con spent_at inválida de los totales sin crash', () => {
    const invalidExpense: Expense = {
      ...expense,
      id: 'e2',
      spent_at: 'invalid',
    };
    const { getByText } = setup([invalidExpense], [category]);

    expect(getByText('Supermercado')).toBeTruthy();
    expect(getByText('0,00 €')).toBeTruthy();
    expect(getByText(/0,00 € \/ 200,00 €/)).toBeTruthy();
  });

  it('abre modal y guarda gasto nuevo', async () => {
    const { getByText, getByLabelText } = setup([], [category]);

    fireEvent.press(getByText('add'));
    await waitFor(() => {
      expect(getByText('Nuevo gasto')).toBeTruthy();
    });

    fireEvent.changeText(getByLabelText('Concepto'), 'Pan');
    fireEvent.changeText(getByLabelText('Importe (€)'), '2.50');
    fireEvent.press(getByText('Guardar'));

    await waitFor(() => {
      expect(mockAddExpense).toHaveBeenCalledWith(
        expect.objectContaining({
          casa_id: 'c1',
          user_id: 'u1',
          title: 'Pan',
          amount: 2.5,
        }),
      );
    });
  });

  it('muestra Alert si addExpense falla', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockAddExpense.mockResolvedValue({ message: 'Problema de conexión. Inténtalo de nuevo.' });
    const { getByText, getByLabelText } = setup([], [category]);

    fireEvent.press(getByText('add'));
    await waitFor(() => expect(getByText('Nuevo gasto')).toBeTruthy());

    fireEvent.changeText(getByLabelText('Concepto'), 'Pan');
    fireEvent.changeText(getByLabelText('Importe (€)'), '2.50');
    fireEvent.press(getByText('Guardar'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Error',
        'Problema de conexión. Inténtalo de nuevo.',
      );
    });
    alertSpy.mockRestore();
  });

  it('muestra modal de secciones y añade categoría', async () => {
    const { getByText, getByLabelText } = setup([], []);

    fireEvent.press(getByText('layers-outline'));
    await waitFor(() => {
      expect(getByText('Secciones de gasto')).toBeTruthy();
    });

    fireEvent.changeText(getByLabelText('Nombre de la sección'), 'Bebé');
    fireEvent.changeText(getByLabelText('Presupuesto mensual (€)'), '150');
    fireEvent.press(getByText('Añadir sección'));

    await waitFor(() => {
      expect(mockAddCategory).toHaveBeenCalledWith(
        expect.objectContaining({ casa_id: 'c1', name: 'Bebé', budget: 150 }),
      );
    });
  });

  it('elimina gasto tras confirmar', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByLabelText } = setup([expense], [category]);

    fireEvent.press(getByLabelText('Eliminar gasto Supermercado'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Eliminar gasto',
      expect.any(String),
      expect.any(Array),
    );
    const buttons = alertSpy.mock.calls[0][2] as
      | { text: string; onPress?: () => void }[]
      | undefined;
    const deleteButton = buttons?.find((b) => b.text === 'Eliminar');
    await deleteButton?.onPress?.();

    await waitFor(() => {
      expect(mockRemoveExpense).toHaveBeenCalledWith('e1');
    });
    alertSpy.mockRestore();
  });

  it('muestra aviso de crear casa cuando no hay casa', () => {
    mockUseCasa.mockReturnValue({ currentCasa: null, loading: false });
    const { getByText } = render(<GastosScreen />);
    expect(getByText('Crea una casa primero')).toBeTruthy();
    expect(getByText('Ir a Ajustes')).toBeTruthy();
  });
});