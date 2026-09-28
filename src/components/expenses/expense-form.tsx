import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppDatePicker } from '@/components/ui/app-date-picker';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { safeDate, toISODate } from '@/lib/date';
import type { Category, Expense } from '@/lib/types';
import { validateAmount, validateTitle } from '@/lib/validation';

export interface ExpenseFormInput {
  title: string;
  amount: number;
  category_id: string | null;
  spent_at: string;
}

interface ExpenseFormProps {
  visible: boolean;
  expense: Expense | null;
  categories: Category[];
  saving: boolean;
  onClose: () => void;
  onSave: (input: ExpenseFormInput) => void;
}

export function ExpenseForm({
  visible,
  expense,
  categories,
  saving,
  onClose,
  onSave,
}: ExpenseFormProps) {
  const [title, setTitle] = useState(expense?.title ?? '');
  const [amount, setAmount] = useState(expense ? String(expense.amount) : '');
  const [categoryId, setCategoryId] = useState<string | null>(expense?.category_id ?? null);
  const [date, setDate] = useState(expense ? safeDate(expense.spent_at) ?? new Date() : new Date());
  const [errors, setErrors] = useState<{ title?: string; amount?: string }>({});

  function handleSave() {
    const titleCheck = validateTitle(title);
    const amountCheck = validateAmount(Number(amount));
    setErrors({
      title: titleCheck.valid ? undefined : titleCheck.message,
      amount: amountCheck.valid ? undefined : amountCheck.message,
    });
    if (!titleCheck.valid || !amountCheck.valid) return;

    onSave({
      title,
      amount: Number(amount),
      category_id: categoryId,
      spent_at: date.toISOString(),
    });
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      accessibilityViewIsModal
      onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>
            {expense ? 'Editar gasto' : 'Nuevo gasto'}
          </Text>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
            <TextField
              label="Concepto"
              value={title}
              onChangeText={setTitle}
              error={errors.title}
            />
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
                  accessibilityRole="radio"
                  accessibilityState={{ checked: categoryId === null }}
                  onPress={() => setCategoryId(null)}>
                  <Text style={[styles.chipText, categoryId === null && styles.chipTextSelected]}>
                    Sin sección
                  </Text>
                </Pressable>
                {categories.map((c) => (
                  <Pressable
                    key={c.id}
                    style={[styles.chip, categoryId === c.id && styles.chipSelected]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: categoryId === c.id }}
                    onPress={() => setCategoryId(c.id)}>
                    <Text style={[styles.chipText, categoryId === c.id && styles.chipTextSelected]}>
                      {c.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <AppDatePicker
              value={date}
              mode="date"
              onChange={setDate}
              icon="📅"
              formatValue={toISODate}
              accessibilityLabel={`Cambiar fecha: ${toISODate(date)}`}
            />

            <View style={styles.modalActions}>
              <Button title="Cancelar" variant="secondary" onPress={onClose} />
              <Button
                title={expense ? 'Guardar cambios' : 'Guardar'}
                onPress={handleSave}
                loading={saving}
              />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: Palette.overlay, justifyContent: 'flex-end' },
  modal: {
    backgroundColor: Palette.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing.four,
    maxHeight: '92%',
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: Palette.text, marginBottom: Spacing.three },
  form: { gap: Spacing.three },
  label: { fontSize: 14, fontWeight: '600', color: Palette.textStrong },
  chipWrap: { gap: Spacing.two },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
  },
  chipSelected: { backgroundColor: Palette.primary, borderColor: Palette.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: Palette.textSecondary },
  chipTextSelected: { color: Palette.onPrimary },
  modalActions: { flexDirection: 'row', gap: Spacing.three, marginTop: Spacing.two },
});