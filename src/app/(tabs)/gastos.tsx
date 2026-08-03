import { useMemo, useState } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
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
} from '@/lib/api';
import { toISODate } from '@/lib/date';
import { totalsByCategory } from '@/lib/finance';
import { formatCurrency } from '@/lib/format';
import type { Category, Expense } from '@/lib/types';
import { validateAmount, validateBudget, validateTitle } from '@/lib/validation';

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

  const [expenseModal, setExpenseModal] = useState(false);
  const [categoryModal, setCategoryModal] = useState(false);
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [date, setDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [errors, setErrors] = useState<{ title?: string; amount?: string }>({});
  const [saving, setSaving] = useState(false);

  const [catName, setCatName] = useState('');
  const [catBudget, setCatBudget] = useState('');
  const [catColor, setCatColor] = useState('#3c87f7');
  const [catErrors, setCatErrors] = useState<{ name?: string; budget?: string }>({});

  const totals = useMemo(
    () => totalsByCategory(expenses, categories),
    [expenses, categories],
  );

  const now = useMemo(() => new Date(), []);
  const monthTotal = totals.reduce((sum, t) => sum + t.total, 0);

  async function handleAddExpense() {
    const titleCheck = validateTitle(title);
    const amountCheck = validateAmount(Number(amount));
    setErrors({
      title: titleCheck.valid ? undefined : titleCheck.message,
      amount: amountCheck.valid ? undefined : amountCheck.message,
    });
    if (!titleCheck.valid || !amountCheck.valid || !currentCasa || !user) return;

    setSaving(true);
    const error = await addExpense({
      casa_id: currentCasa.id,
      user_id: user.id,
      category_id: categoryId,
      title,
      amount: Number(amount),
      spent_at: date.toISOString(),
    });
    setSaving(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    setTitle('');
    setAmount('');
    setCategoryId(null);
    setExpenseModal(false);
  }

  async function handleAddCategory() {
    const nameCheck = validateTitle(catName);
    const budgetCheck = validateBudget(catBudget ? Number(catBudget) : null);
    setCatErrors({
      name: nameCheck.valid ? undefined : nameCheck.message,
      budget: budgetCheck.valid ? undefined : budgetCheck.message,
    });
    if (!nameCheck.valid || !budgetCheck.valid || !currentCasa) return;

    setSaving(true);
    const error = await addCategory({
      casa_id: currentCasa.id,
      name: catName,
      color: catColor,
      icon: 'pricetag',
      budget: catBudget ? Number(catBudget) : null,
    });
    setSaving(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    setCatName('');
    setCatBudget('');
    setCategoryModal(false);
  }

  async function handleDeleteCategory(id: string) {
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

  async function handleDeleteExpense(id: string) {
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

  const monthExpenses = expenses.filter(
    (e) => toISODate(new Date(e.spent_at)) === toISODate(now),
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Gastos</Text>
          <Text style={styles.subtitle}>
            Total hoy: {formatCurrency(monthExpenses.reduce((s, e) => s + e.amount, 0))}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable style={styles.iconButton} onPress={() => setCategoryModal(true)}>
            <Ionicons name="layers-outline" size={22} color="#3c87f7" />
          </Pressable>
          <Pressable style={styles.fab} onPress={() => setExpenseModal(true)}>
            <Ionicons name="add" size={26} color="#ffffff" />
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
                            backgroundColor: t.overBudget ? '#dc2626' : '#3c87f7',
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
        {expenses.length === 0 ? (
          <EmptyState
            icon="wallet-outline"
            title="Sin gastos registrados"
            subtitle="Apunta tus compras para llevar la contabilidad."
          />
        ) : (
          expenses.slice(0, 30).map((e) => {
            const category = categories.find((c) => c.id === e.category_id);
            return (
              <Card key={e.id} style={styles.expenseRow}>
                <View style={[styles.colorDot, { backgroundColor: category?.color ?? '#9ca3af' }]} />
                <View style={styles.categoryInfo}>
                  <Text style={styles.categoryName}>{e.title}</Text>
                  <Text style={styles.cardMeta}>
                    {category?.name ?? 'Sin sección'} ·{' '}
                    {e.spent_at.slice(0, 10).split('-').reverse().join('/')}
                  </Text>
                </View>
                <View style={styles.expenseRight}>
                  <Text style={styles.expenseAmount}>{formatCurrency(e.amount)}</Text>
                  <Pressable onPress={() => handleDeleteExpense(e.id)} hitSlop={10}>
                    <Ionicons name="trash-outline" size={18} color="#dc2626" />
                  </Pressable>
                </View>
              </Card>
            );
          })
        )}
      </ScrollView>

      {/* Modal nuevo gasto */}
      <Modal
        visible={expenseModal}
        animationType="slide"
        transparent
        onRequestClose={() => setExpenseModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Nuevo gasto</Text>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
              <TextField label="Concepto" value={title} onChangeText={setTitle} error={errors.title} />
              <TextField
                label="Importe (€)"
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
                error={errors.amount}
              />

              <View style={styles.chipWrap}>
                <Text style={styles.label}>Sección</Text>
                <View style={styles.chipRow}>
                  <Pressable
                    style={[styles.chip, categoryId === null && styles.chipSelected]}
                    onPress={() => setCategoryId(null)}>
                    <Text
                      style={[styles.chipText, categoryId === null && styles.chipTextSelected]}>
                      Sin sección
                    </Text>
                  </Pressable>
                  {categories.map((c) => (
                    <Pressable
                      key={c.id}
                      style={[styles.chip, categoryId === c.id && styles.chipSelected]}
                      onPress={() => setCategoryId(c.id)}>
                      <Text style={[styles.chipText, categoryId === c.id && styles.chipTextSelected]}>
                        {c.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <Pressable style={styles.dateButton} onPress={() => setShowDatePicker(true)}>
                <Text style={styles.dateButtonLabel}>📅 {toISODate(date)}</Text>
              </Pressable>
              {showDatePicker && (
                <DateTimePicker
                  value={date}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(_, selected) => {
                    setShowDatePicker(false);
                    if (selected) setDate(selected);
                  }}
                />
              )}

              <View style={styles.modalActions}>
                <Button title="Cancelar" variant="secondary" onPress={() => setExpenseModal(false)} />
                <Button title="Guardar" onPress={handleAddExpense} loading={saving} />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Modal secciones */}
      <Modal
        visible={categoryModal}
        animationType="slide"
        transparent
        onRequestClose={() => setCategoryModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Secciones de gasto</Text>
            <ScrollView contentContainerStyle={styles.form}>
              <TextField
                label="Nombre de la sección"
                value={catName}
                onChangeText={setCatName}
                placeholder="P. ej. Bebé, Reformas, Comida"
                error={catErrors.name}
              />
              <TextField
                label="Presupuesto mensual (€)"
                value={catBudget}
                onChangeText={setCatBudget}
                keyboardType="decimal-pad"
                placeholder="Opcional"
                error={catErrors.budget}
              />

              <View style={styles.colorRow}>
                {['#3c87f7', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'].map((c) => (
                  <Pressable
                    key={c}
                    style={[styles.colorOption, { backgroundColor: c }, catColor === c && styles.colorSelected]}
                    onPress={() => setCatColor(c)}
                  />
                ))}
              </View>

              <Button title="Añadir sección" onPress={handleAddCategory} loading={saving} />

              {categories.map((c) => (
                <View key={c.id} style={styles.categoryManageRow}>
                  <View style={[styles.colorDot, { backgroundColor: c.color }]} />
                  <Text style={styles.categoryName}>{c.name}</Text>
                  <Pressable onPress={() => handleDeleteCategory(c.id)} hitSlop={10}>
                    <Ionicons name="trash-outline" size={18} color="#dc2626" />
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.four,
    paddingBottom: Spacing.three,
  },
  headerText: { gap: Spacing.one },
  title: { fontSize: 28, fontWeight: '700', color: '#111827' },
  subtitle: { fontSize: 14, color: '#6b7280' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#d1d5db',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fab: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#3c87f7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { paddingHorizontal: Spacing.four, gap: Spacing.three, paddingBottom: Spacing.six },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#111827', marginTop: Spacing.two },
  total: { fontSize: 32, fontWeight: '800', color: '#111827' },
  empty: { fontSize: 14, color: '#9ca3af' },
  categoryRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  colorDot: { width: 12, height: 12, borderRadius: 6 },
  categoryInfo: { flex: 1, gap: Spacing.one },
  categoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  categoryName: { fontSize: 15, fontWeight: '600', color: '#374151' },
  categoryAmount: { fontSize: 14, fontWeight: '600', color: '#111827' },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: '#e5e7eb', overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3 },
  cardMeta: { fontSize: 13, color: '#6b7280' },
  expenseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
  },
  expenseRight: { alignItems: 'flex-end', gap: Spacing.one },
  expenseAmount: { fontSize: 15, fontWeight: '700', color: '#111827' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modal: {
    backgroundColor: '#fff',
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    padding: Spacing.four,
    maxHeight: '92%',
  },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: Spacing.three },
  form: { gap: Spacing.three },
  label: { fontSize: 14, fontWeight: '600', color: '#4b5563' },
  chipWrap: { gap: Spacing.two },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
  },
  chipSelected: { backgroundColor: '#3c87f7', borderColor: '#3c87f7' },
  chipText: { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  chipTextSelected: { color: '#fff' },
  dateButton: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  dateButtonLabel: { fontSize: 15, fontWeight: '600', color: '#374151' },
  modalActions: { flexDirection: 'row', gap: Spacing.three, marginTop: Spacing.two },
  colorRow: { flexDirection: 'row', gap: Spacing.two },
  colorOption: { width: 36, height: 36, borderRadius: 18 },
  colorSelected: { borderWidth: 3, borderColor: '#111827' },
  categoryManageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    paddingVertical: Spacing.three,
  },
});
