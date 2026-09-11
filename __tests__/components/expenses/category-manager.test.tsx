import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { CategoryManager } from '@/components/expenses/category-manager';
import type { Category } from '@/lib/types';

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

function setup(overrides?: { editingCategory?: Category | null }) {
  const onSave = jest.fn();
  const onClose = jest.fn();
  const onEdit = jest.fn();
  const onDelete = jest.fn();
  const result = render(
    <CategoryManager
      visible
      categories={[category]}
      editingCategory={overrides?.editingCategory ?? null}
      saving={false}
      onClose={onClose}
      onSave={onSave}
      onEdit={onEdit}
      onDelete={onDelete}
    />,
  );
  return { ...result, onSave, onClose, onEdit, onDelete };
}

beforeEach(() => jest.clearAllMocks());

describe('CategoryManager', () => {
  it('renderiza título secciones sin edición', () => {
    const { getByText } = setup();
    expect(getByText('Secciones de gasto')).toBeTruthy();
    expect(getByText('Añadir sección')).toBeTruthy();
  });

  it('rellena campos al editar categoría existente', () => {
    const { getByDisplayValue } = setup({ editingCategory: category });
    expect(getByDisplayValue('Comida')).toBeTruthy();
    expect(getByDisplayValue('200')).toBeTruthy();
  });

  it('llama onSave con input válido', async () => {
    const { onSave, getByText, getAllByDisplayValue } = setup();
    const [nameInput, budgetInput] = getAllByDisplayValue('');
    fireEvent.changeText(nameInput, 'Bebé');
    fireEvent.changeText(budgetInput, '150');
    fireEvent.press(getByText('Añadir sección'));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Bebé',
          budget: 150,
          icon: 'pricetag',
        }),
      );
    });
  });

  it('llama onDelete al pulsar trash', () => {
    const { onDelete, getAllByText } = setup();
    fireEvent.press(getAllByText('trash-outline')[0]);
    expect(onDelete).toHaveBeenCalledWith('cat1');
  });

  it('llama onEdit al pulsar pencil', () => {
    const { onEdit, getAllByText } = setup();
    fireEvent.press(getAllByText('pencil-outline')[0]);
    expect(onEdit).toHaveBeenCalledWith(category);
  });

  it('muestra error si nombre vacío', async () => {
    const { onSave, getByText } = setup();
    fireEvent.press(getByText('Añadir sección'));
    await waitFor(() => {
      expect(onSave).not.toHaveBeenCalled();
    });
  });
});
