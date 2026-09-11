import { useEffect, useState } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { toISODate } from '@/lib/date';
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
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [date, setDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [errors, setErrors] = useState<{ title?: string; amount?: string }>({});

  useEffect(() => {
    if (visible) {
      setTitle(expense?.title ?? '');
      setAmount(expense ? String(expense.amount) : '');
      setCategoryId(expense?.category_id ?? null);
      setDate(expense ? new Date(expense.spent_at) : new Date());
      setShowDatePicker(false);
      setErrors({});
    }
  }, [visible, expense]);

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
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
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
                  onPress={() => setCategoryId(null)}>
                  <Text style={[styles.chipText, categoryId === null && styles.chipTextSelected]}>
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
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
  },
  chipSelected: { backgroundColor: Palette.primary, borderColor: Palette.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: Palette.textSecondary },
  chipTextSelected: { color: Palette.onPrimary },
  dateButton: {
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.md,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    backgroundColor: Palette.surface,
  },
  dateButtonLabel: { fontSize: 15, fontWeight: '600', color: Palette.textStrong },
  modalActions: { flexDirection: 'row', gap: Spacing.three, marginTop: Spacing.two },
});