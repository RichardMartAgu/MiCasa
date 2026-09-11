import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';

import { CategoryManager } from '@/components/expenses/category-manager';
import type { CategoryManagerInput } from '@/components/expenses/category-manager';
import { ExpenseForm } from '@/components/expenses/expense-form';
import type { ExpenseFormInput } from '@/components/expenses/expense-form';
import { ExpenseList } from '@/components/expenses/expense-list';
import { Card } from '@/components/ui/card';
import { Palette, Radius, Shadow, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useCasa } from '@/context/casa-context';
import { useRealtimeCollection } from '@/hooks/use-realtime-collection';
import {
  addCategory,
  addExpense,
  fetchCategories,
  fetchExpenses,
  removeCategory,
  removeExpense,
  updateCategory,
  updateExpense,
} from '@/lib/api';
import { monthKey, toISODate } from '@/lib/date';
import { totalsByCategory } from '@/lib/finance';
import { formatCurrency } from '@/lib/format';
import type { Category, Expense } from '@/lib/types';

export default function GastosScreen() {
  const { user } = useAuth();
  const { currentCasa } = useCasa();
  const { data: expenses } = useRealtimeCollection<Expense>(
    () => (currentCasa ? fetchExpenses(currentCasa.id) : Promise.resolve([])),
    'expenses',
    currentCasa?.id ?? null,
  );
  const { data: categories } = useRealtimeCollection<Category>(
    () => (currentCasa ? fetchCategories(currentCasa.id) : Promise.resolve([])),
    'categories',
    currentCasa?.id ?? null,
  );

  const [expenseModalVisible, setExpenseModalVisible] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [categoryModalVisible, setCategoryModalVisible] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [saving, setSaving] = useState(false);
  const [expenseFormKey, setExpenseFormKey] = useState(0);
  const [categoryFormKey, setCategoryFormKey] = useState(0);

  const now = useMemo(() => new Date(), []);
  const thisMonth = monthKey(now);
  const totals = useMemo(
    () =>
      totalsByCategory(
        expenses.filter((e) => monthKey(new Date(e.spent_at)) === thisMonth),
        categories,
      ),
    [expenses, categories, thisMonth],
  );
  const monthTotal = totals.reduce((sum, t) => sum + t.total, 0);
  const todayTotal = expenses
    .filter((e) => toISODate(new Date(e.spent_at)) === toISODate(now))
    .reduce((sum, e) => sum + e.amount, 0);

  function openAddExpense() {
    setEditingExpense(null);
    setExpenseFormKey((k) => k + 1);
    setExpenseModalVisible(true);
  }

  function openEditExpense(expense: Expense) {
    setEditingExpense(expense);
    setExpenseFormKey((k) => k + 1);
    setExpenseModalVisible(true);
  }

  async function handleSaveExpense(input: ExpenseFormInput) {
    if (!currentCasa || !user) return;
    setSaving(true);
    const error = editingExpense
      ? await updateExpense(editingExpense.id, input)
      : await addExpense({ ...input, casa_id: currentCasa.id, user_id: user.id });
    setSaving(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    setExpenseModalVisible(false);
  }

  function openAddCategory() {
    setEditingCategory(null);
    setCategoryFormKey((k) => k + 1);
    setCategoryModalVisible(true);
  }

  function openEditCategory(category: Category) {
    setEditingCategory(category);
    setCategoryFormKey((k) => k + 1);
    setCategoryModalVisible(true);
  }

  async function handleSaveCategory(input: CategoryManagerInput) {
    if (!currentCasa) return;
    setSaving(true);
    const error = editingCategory
      ? await updateCategory(editingCategory.id, input)
      : await addCategory({ ...input, casa_id: currentCasa.id });
    setSaving(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    setCategoryModalVisible(false);
  }

  function handleDeleteCategory(id: string) {
    Alert.alert('Eliminar sección', '¿Seguro? Los gastos de esa sección se quedarán sin categoría.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          const error = await removeCategory(id);
          if (error) Alert.alert('Error', error.message);
        },
      },
    ]);
  }

  function handleDeleteExpense(id: string) {
    Alert.alert('Eliminar gasto', '¿Seguro que quieres eliminar este gasto?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          const error = await removeExpense(id);
          if (error) Alert.alert('Error', error.message);
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Gastos</Text>
          <Text style={styles.subtitle}>
            Total hoy: {formatCurrency(todayTotal)}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable style={styles.iconButton} onPress={openAddCategory}>
            <Ionicons name="layers-outline" size={22} color={Palette.primary} />
          </Pressable>
          <Pressable style={styles.fab} onPress={openAddExpense}>
            <Ionicons name="add" size={26} color={Palette.onPrimary} />
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <Text style={styles.sectionTitle}>Este mes</Text>
          <Text style={styles.total}>{formatCurrency(monthTotal)}</Text>

          {categories.length === 0 ? (
            <Text style={styles.empty}>
              Crea secciones (Bebé, Reformas, Comida…) para organizar tus gastos.
            </Text>
          ) : (
            totals.map((t) => (
              <View key={t.id} style={styles.categoryRow}>
                <View style={[styles.colorDot, { backgroundColor: t.color }]} />
                <View style={styles.categoryInfo}>
                  <View style={styles.categoryHeader}>
                    <Text style={styles.categoryName}>{t.name}</Text>
                    <Text style={styles.categoryAmount}>
                      {formatCurrency(t.total)}
                      {t.budget ? ` / ${formatCurrency(t.budget)}` : ''}
                    </Text>
                  </View>
                  {t.budget ? (
                    <View style={styles.progressTrack}>
                      <View
                        style={[
                          styles.progressFill,
                          {
                            width: `${Math.min(100, (t.total / t.budget) * 100)}%`,
                            backgroundColor: t.overBudget ? Palette.danger : Palette.primary,
                          },
                        ]}
                      />
                    </View>
                  ) : null}
                </View>
              </View>
            ))
          )}
        </Card>

        <Text style={styles.sectionTitle}>Historial</Text>
        <ExpenseList
          expenses={expenses}
          categories={categories}
          onEdit={openEditExpense}
          onDelete={handleDeleteExpense}
        />
      </ScrollView>

      <ExpenseForm
        key={expenseFormKey}
        visible={expenseModalVisible}
        expense={editingExpense}
        categories={categories}
        saving={saving}
        onClose={() => setExpenseModalVisible(false)}
        onSave={handleSaveExpense}
      />

      <CategoryManager
        key={categoryFormKey}
        visible={categoryModalVisible}
        categories={categories}
        editingCategory={editingCategory}
        saving={saving}
        onClose={() => setCategoryModalVisible(false)}
        onSave={handleSaveCategory}
        onEdit={openEditCategory}
        onDelete={handleDeleteCategory}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.four,
    paddingBottom: Spacing.three,
  },
  headerText: { gap: Spacing.one },
  title: { fontSize: 28, fontWeight: '800', color: Palette.text },
  subtitle: { fontSize: 14, color: Palette.textSecondary },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fab: {
    width: 48,
    height: 48,
    borderRadius: Radius.pill,
    backgroundColor: Palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.fab,
  },
  content: { paddingHorizontal: Spacing.four, gap: Spacing.three, paddingBottom: Spacing.six },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: Palette.text, marginTop: Spacing.two },
  total: { fontSize: 32, fontWeight: '800', color: Palette.primary },
  empty: { fontSize: 14, color: Palette.textMuted },
  categoryRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  colorDot: { width: 12, height: 12, borderRadius: 6 },
  categoryInfo: { flex: 1, gap: Spacing.one },
  categoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  categoryName: { fontSize: 15, fontWeight: '600', color: Palette.textStrong },
  categoryAmount: { fontSize: 14, fontWeight: '600', color: Palette.text },
  progressTrack: {
    height: 6,
    borderRadius: Radius.pill,
    backgroundColor: Palette.surfaceMuted,
    overflow: 'hidden',
  },
  progressFill: { height: 6, borderRadius: Radius.pill },
});