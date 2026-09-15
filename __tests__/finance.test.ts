import {
  monthlyTotals,
  parseAmount,
  sumByCategory,
  totalExpenses,
  totalsByCategory,
} from '@/lib/finance';
import type { Category, Expense } from '@/lib/types';

function expense(overrides: Partial<Expense>): Expense {
  return {
    id: 'id',
    casa_id: 'casa',
    category_id: null,
    user_id: null,
    title: 'Gasto',
    amount: 0,
    spent_at: '2026-08-03T10:00:00',
    note: null,
    created_at: '2026-08-03T10:00:00',
    ...overrides,
  };
}

describe('parseAmount', () => {
  it('redondea a 2 decimales', () => {
    expect(parseAmount(10.005)).toBe(10.01);
    expect(parseAmount(19.999)).toBe(20);
  });
});

describe('totalExpenses', () => {
  it('suma todos los gastos', () => {
    const expenses = [
      expense({ amount: 10.5 }),
      expense({ amount: 4.25 }),
      expense({ amount: 0.01 }),
    ];
    expect(totalExpenses(expenses)).toBe(14.76);
  });

  it('devuelve 0 si no hay gastos', () => {
    expect(totalExpenses([])).toBe(0);
  });
});

describe('sumByCategory', () => {
  it('agrupa por categoría', () => {
    const expenses = [
      expense({ category_id: 'a', amount: 10 }),
      expense({ category_id: 'a', amount: 5 }),
      expense({ category_id: 'b', amount: 3 }),
      expense({ category_id: null, amount: 2 }),
    ];
    expect(sumByCategory(expenses)).toEqual({ a: 15, b: 3, uncategorized: 2 });
  });
});

describe('totalsByCategory', () => {
  const categories: Category[] = [
    {
      id: 'a',
      casa_id: 'casa',
      name: 'Bebé',
      color: '#111',
      icon: 'pricetag',
      budget: 100,
      created_at: '',
    },
    {
      id: 'b',
      casa_id: 'casa',
      name: 'Reformas',
      color: '#222',
      icon: 'pricetag',
      budget: null,
      created_at: '',
    },
  ];

  it('calcula totales, restantes y si supera el presupuesto', () => {
    const expenses = [
      expense({ category_id: 'a', amount: 60 }),
      expense({ category_id: 'a', amount: 50 }),
      expense({ category_id: 'b', amount: 30 }),
    ];
    const totals = totalsByCategory(expenses, categories);

    const bebe = totals.find((t) => t.id === 'a');
    const reformas = totals.find((t) => t.id === 'b');

    expect(bebe?.total).toBe(110);
    expect(bebe?.remaining).toBe(-10);
    expect(bebe?.overBudget).toBe(true);
    expect(reformas?.total).toBe(30);
    expect(reformas?.overBudget).toBe(false);
    expect(reformas?.remaining).toBe(0);
  });
});

describe('monthlyTotals', () => {
  it('agrupa por mes y ordena cronológicamente', () => {
    const expenses = [
      expense({ amount: 10, spent_at: '2026-08-03T10:00:00' }),
      expense({ amount: 5, spent_at: '2026-07-01T10:00:00' }),
      expense({ amount: 20, spent_at: '2026-08-15T10:00:00' }),
    ];
    const totals = monthlyTotals(expenses, 'es-ES');
    expect(totals).toHaveLength(2);
    expect(totals[0].key).toBe('2026-07');
    expect(totals[0].total).toBe(5);
    expect(totals[1].key).toBe('2026-08');
    expect(totals[1].total).toBe(30);
  });

  it('excluye gastos con spent_at inválida', () => {
    const expenses = [
      expense({ amount: 10, spent_at: '2026-08-03T10:00:00' }),
      expense({ amount: 99, spent_at: 'invalid' }),
      expense({ amount: 5, spent_at: '2026-07-01T10:00:00' }),
    ];
    const totals = monthlyTotals(expenses, 'es-ES');
    expect(totals).toHaveLength(2);
    expect(totals[0].total).toBe(5);
    expect(totals[1].total).toBe(10);
  });
});
