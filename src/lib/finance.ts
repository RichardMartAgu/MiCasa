import { safeDate } from './date';
import type { Category, Expense } from './types';

export function parseAmount(value: number): number {
  return Math.round(value * 100) / 100;
}

export function totalExpenses(expenses: Expense[]): number {
  return parseAmount(expenses.reduce((sum, e) => sum + e.amount, 0));
}

export function sumByCategory(expenses: Expense[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const expense of expenses) {
    const key = expense.category_id ?? 'uncategorized';
    totals[key] = parseAmount((totals[key] ?? 0) + expense.amount);
  }
  return totals;
}

export interface CategoryTotal extends Category {
  total: number;
  remaining: number;
  overBudget: boolean;
}

export function totalsByCategory(
  expenses: Expense[],
  categories: Category[],
): CategoryTotal[] {
  const totals = sumByCategory(expenses);
  return categories.map((category) => {
    const total = totals[category.id] ?? 0;
    const hasBudget = category.budget !== null && category.budget > 0;
    const budget = hasBudget ? (category.budget ?? 0) : 0;
    return {
      ...category,
      total,
      remaining: hasBudget ? parseAmount(budget - total) : 0,
      overBudget: hasBudget && total > budget,
    };
  });
}

export function monthlyTotals(
  expenses: Expense[],
  locale = 'es-ES',
): { key: string; label: string; total: number }[] {
  const byMonth: Record<string, number> = {};
  for (const expense of expenses) {
    const date = safeDate(expense.spent_at);
    if (date === null) continue;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    byMonth[key] = parseAmount((byMonth[key] ?? 0) + expense.amount);
  }
  return Object.keys(byMonth)
    .sort()
    .map((key) => {
      const [y, m] = key.split('-').map(Number);
      const label = new Intl.DateTimeFormat(locale, {
        month: 'long',
        year: 'numeric',
      }).format(new Date(y, (m ?? 1) - 1, 1));
      return { key, label, total: byMonth[key] };
    });
}
