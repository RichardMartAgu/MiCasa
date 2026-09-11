import { fireEvent, render } from '@testing-library/react-native';

import { ExpenseList } from '@/components/expenses/expense-list';
import type { Category, Expense } from '@/lib/types';

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

function setup(expenses: Expense[] = []) {
  const onEdit = jest.fn();
  const onDelete = jest.fn();
  const result = render(
    <ExpenseList expenses={expenses} categories={[category]} onEdit={onEdit} onDelete={onDelete} />,
  );
  return { ...result, onEdit, onDelete };
}

beforeEach(() => jest.clearAllMocks());

describe('ExpenseList', () => {
  it('muestra EmptyState sin gastos', () => {
    const { getByText } = setup([]);
    expect(getByText('Sin gastos registrados')).toBeTruthy();
  });

  it('renderiza gasto con nombre de categoría', () => {
    const { getByText } = setup([expense]);
    expect(getByText('Supermercado')).toBeTruthy();
    expect(getByText(/Comida/)).toBeTruthy();
  });

  it('llama onEdit al pulsar pencil', () => {
    const { onEdit, getAllByText } = setup([expense]);
    fireEvent.press(getAllByText('pencil-outline')[0]);
    expect(onEdit).toHaveBeenCalledWith(expense);
  });

  it('llama onDelete al pulsar trash', () => {
    const { onDelete, getAllByText } = setup([expense]);
    fireEvent.press(getAllByText('trash-outline')[0]);
    expect(onDelete).toHaveBeenCalledWith('e1');
  });

  it('muestra Sin sección si categoría no existe', () => {
    const expenseNoCat = { ...expense, category_id: 'nonexistent' };
    const { getByText } = setup([expenseNoCat]);
    expect(getByText(/Sin sección/)).toBeTruthy();
  });

  it('muestra solo 30 gastos', () => {
    const manyExpenses = Array.from({ length: 35 }, (_, i) => ({
      ...expense,
      id: `e${i}`,
      title: `Gasto ${i}`,
    }));
    const { queryByText, getByText } = setup(manyExpenses);
    expect(getByText('Gasto 0')).toBeTruthy();
    expect(queryByText('Gasto 30')).toBeNull();
  });
});
