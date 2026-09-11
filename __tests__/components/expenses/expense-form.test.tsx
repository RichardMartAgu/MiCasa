import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { ExpenseForm } from '@/components/expenses/expense-form';
import type { Category, Expense } from '@/lib/types';

jest.mock('@react-native-community/datetimepicker', () => {
  const { View } = require('react-native');
  return function MockPicker({ onChange }: { onChange: (e: unknown, d?: Date) => void }) {
    return (
      <View testID="picker">
        <View testID="pick-date" onTouchEnd={() => onChange({}, new Date(2026, 5, 15))} />
      </View>
    );
  };
});

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: ({ name }: { name: string }) => <Text>{name}</Text> };
});

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

function setup(props?: { expense?: Expense | null }) {
  const onSave = jest.fn();
  const onClose = jest.fn();
  const result = render(
    <ExpenseForm
      visible
      expense={props?.expense ?? null}
      categories={[category]}
      saving={false}
      onClose={onClose}
      onSave={onSave}
    />,
  );
  return { ...result, onSave, onClose };
}

beforeEach(() => jest.clearAllMocks());

describe('ExpenseForm', () => {
  it('renderiza título nuevo gasto sin datos previos', () => {
    const { getByText } = setup();
    expect(getByText('Nuevo gasto')).toBeTruthy();
    expect(getByText('Guardar')).toBeTruthy();
  });

  it('rellena campos al editar gasto existente', () => {
    const { getByDisplayValue } = setup({ expense });
    expect(getByDisplayValue('Supermercado')).toBeTruthy();
    expect(getByDisplayValue('45.5')).toBeTruthy();
  });

  it('llama onSave con input correcto', async () => {
    const { onSave, getByText, getAllByDisplayValue } = setup();
    const [titleInput, amountInput] = getAllByDisplayValue('');
    fireEvent.changeText(titleInput, 'Pan');
    fireEvent.changeText(amountInput, '2.50');
    fireEvent.press(getByText('Guardar'));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Pan',
          amount: 2.5,
          category_id: null,
        }),
      );
    });
  });

  it('llama onClose al pulsar Cancelar', () => {
    const { onClose, getByText } = setup();
    fireEvent.press(getByText('Cancelar'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('muestra error si validación falla', async () => {
    const { onSave, getByText, getAllByDisplayValue } = setup();
    const [titleInput, amountInput] = getAllByDisplayValue('');
    fireEvent.changeText(titleInput, '');
    fireEvent.changeText(amountInput, '');
    fireEvent.press(getByText('Guardar'));
    await waitFor(() => {
      expect(onSave).not.toHaveBeenCalled();
    });
  });

  it('permite seleccionar categoría por chip', async () => {
    const { onSave, getByText, getAllByDisplayValue } = setup();
    const [titleInput, amountInput] = getAllByDisplayValue('');
    fireEvent.changeText(titleInput, 'Pan');
    fireEvent.changeText(amountInput, '2.50');
    fireEvent.press(getByText('Comida'));
    fireEvent.press(getByText('Guardar'));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ category_id: 'cat1' }),
      );
    });
  });
});
