import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Palette, Spacing } from '@/constants/theme';
import { formatCurrency } from '@/lib/format';
import type { Category, Expense } from '@/lib/types';

interface ExpenseListProps {
  expenses: Expense[];
  categories: Category[];
  onEdit: (expense: Expense) => void;
  onDelete: (id: string) => void;
}

export function ExpenseList({ expenses, categories, onEdit, onDelete }: ExpenseListProps) {
  if (expenses.length === 0) {
    return (
      <EmptyState
        icon="wallet-outline"
        title="Sin gastos registrados"
        subtitle="Apunta tus compras para llevar la contabilidad."
      />
    );
  }

  return (
    <>
      {expenses.map((e) => {
        const category = categories.find((c) => c.id === e.category_id);
        return (
          <Card key={e.id} style={styles.expenseRow}>
            <View
              style={[styles.colorDot, { backgroundColor: category?.color ?? Palette.textMuted }]}
            />
            <View style={styles.categoryInfo}>
              <Text style={styles.categoryName}>{e.title}</Text>
              <Text style={styles.cardMeta}>
                {category?.name ?? 'Sin sección'} ·{' '}
                {e.spent_at.slice(0, 10).split('-').reverse().join('/')}
              </Text>
            </View>
            <View style={styles.expenseRight}>
              <Text style={styles.expenseAmount}>{formatCurrency(e.amount)}</Text>
              <View style={styles.rowActions}>
                <Pressable onPress={() => onEdit(e)} hitSlop={10}>
                  <Ionicons name="pencil-outline" size={18} color={Palette.textSecondary} />
                </Pressable>
                <Pressable onPress={() => onDelete(e.id)} hitSlop={10}>
                  <Ionicons name="trash-outline" size={18} color={Palette.danger} />
                </Pressable>
              </View>
            </View>
          </Card>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  expenseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
  },
  colorDot: { width: 12, height: 12, borderRadius: 6 },
  categoryInfo: { flex: 1, gap: Spacing.one },
  categoryName: { fontSize: 15, fontWeight: '600', color: Palette.textStrong },
  cardMeta: { fontSize: 13, color: Palette.textSecondary },
  expenseRight: { alignItems: 'flex-end', gap: Spacing.one },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  expenseAmount: { fontSize: 15, fontWeight: '700', color: Palette.text },
});