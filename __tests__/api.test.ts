import {
  addAppointment,
  addCategory,
  addContact,
  addExpense,
  addShoppingItem,
  addShoppingList,
  fetchAppointments,
  fetchCategories,
  fetchContacts,
  fetchExpenses,
  fetchShoppingItems,
  fetchShoppingLists,
  removeAppointment,
  removeCategory,
  removeContact,
  removeExpense,
  removeShoppingItem,
  removeShoppingList,
  toggleShoppingItem,
  toggleShoppingList,
  updateAppointment,
  updateCategory,
  updateContact,
  updateExpense,
} from '@/lib/api';

const mockFrom = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

function makeQuery(result: Record<string, unknown>) {
  const query: Record<string, unknown> & { then: (onfulfilled: (value: unknown) => unknown) => unknown } = {
    then: (resolve: (value: unknown) => unknown) => resolve(result),
  };
  for (const method of ['select', 'eq', 'order', 'insert', 'update', 'delete', 'single', 'in']) {
    query[method] = jest.fn(() => query);
  }
  return query;
}

function setupFrom(result: Record<string, unknown>) {
  const query = makeQuery(result);
  mockFrom.mockReturnValue(query);
  return query as unknown as Record<string, jest.Mock> & { then: unknown };
}

describe('fetch helpers', () => {
  const casaId = 'casa-1';

  it.each([
    ['fetchCategories', fetchCategories, 'categories'],
    ['fetchExpenses', fetchExpenses, 'expenses'],
    ['fetchAppointments', fetchAppointments, 'appointments'],
    ['fetchShoppingLists', fetchShoppingLists, 'shopping_lists'],
    ['fetchContacts', fetchContacts, 'contacts'],
  ])('%s devuelve filas filtradas por casa', async (_name, fn, table) => {
    const rows = [{ id: '1', casa_id: casaId }];
    const query = setupFrom({ data: rows });
    const result = await (fn as (id: string) => Promise<unknown[]>)(casaId);

    expect(mockFrom).toHaveBeenCalledWith(table);
    expect((query as Record<string, jest.Mock>).select).toHaveBeenCalled();
    expect(result).toEqual(rows);
  });

  it('devuelve [] cuando no hay datos', async () => {
    const query = setupFrom({ data: null });
    const result = await fetchCategories(casaId);
    expect(result).toEqual([]);
    expect((query as Record<string, jest.Mock>).select).toHaveBeenCalledWith('*');
  });
});

describe('fetchShoppingItems', () => {
  it('filtra por list_id', async () => {
    const listId = 'list-1';
    const rows = [{ id: '1', list_id: listId, name: 'Leche' }];
    const query = setupFrom({ data: rows });
    const result = await fetchShoppingItems(listId);

    expect(mockFrom).toHaveBeenCalledWith('shopping_items');
    expect((query as Record<string, jest.Mock>).eq).toHaveBeenCalledWith('list_id', listId);
    expect(result).toEqual(rows);
  });
});

describe('mutaciones con error', () => {
  it('addCategory devuelve error traducido', async () => {
    setupFrom({ error: { message: 'duplicate key value violates unique constraint' } });
    const error = await addCategory({
      casa_id: 'casa-1',
      name: 'Comida',
      color: '#fff',
      icon: 'pricetag',
      budget: null,
    });

    expect(error).toEqual({ message: 'Ese registro ya existe.' });
  });

  it('addCategory devuelve null sin error', async () => {
    setupFrom({ error: null });
    const error = await addCategory({
      casa_id: 'casa-1',
      name: 'Comida',
      color: '#fff',
      icon: 'pricetag',
      budget: null,
    });

    expect(error).toBeNull();
  });
});

describe('CRUD por tabla', () => {
  const tableCases: [string, () => Promise<unknown>][] = [
    ['updateCategory', () => updateCategory('1', { name: 'x', color: '#fff', icon: 'i', budget: null })],
    ['removeCategory', () => removeCategory('1')],
    ['addExpense', () => addExpense({ casa_id: 'c', user_id: 'u', category_id: null, title: 't', amount: 1, spent_at: '2026-01-01' })],
    ['updateExpense', () => updateExpense('1', { category_id: null, title: 't', amount: 1, spent_at: '2026-01-01' })],
    ['removeExpense', () => removeExpense('1')],
    ['addAppointment', () => addAppointment({ casa_id: 'c', user_id: 'u', title: 't', kind: 'otro', starts_at: '2026-01-01' })],
    ['updateAppointment', () => updateAppointment('1', { title: 't', kind: 'otro', starts_at: '2026-01-01' })],
    ['removeAppointment', () => removeAppointment('1')],
    ['addShoppingList', () => addShoppingList({ casa_id: 'c', user_id: 'u', title: 'Lista' })],
    ['removeShoppingList', () => removeShoppingList('1')],
    ['toggleShoppingList', () => toggleShoppingList('1', true)],
    ['addShoppingItem', () => addShoppingItem({ list_id: 'l', name: 'n' })],
    ['toggleShoppingItem', () => toggleShoppingItem('1', false)],
    ['removeShoppingItem', () => removeShoppingItem('1')],
    ['addContact', () => addContact({ casa_id: 'c', user_id: 'u', name: 'n', birth_date: '2020-01-01' })],
    ['updateContact', () => updateContact('1', { name: 'n', birth_date: '2020-01-01' })],
    ['removeContact', () => removeContact('1')],
  ];

  it.each(tableCases)('%s devuelve null cuando no hay error', async (_name, fn) => {
    setupFrom({ error: null });
    const result = await fn();
    expect(result).toBeNull();
  });

  it.each(tableCases)('%s traduce errores de base de datos', async (_name, fn) => {
    setupFrom({ error: { message: 'duplicate key value violates unique constraint' } });
    const result = await fn();
    expect(result).toEqual({ message: 'Ese registro ya existe.' });
  });
});