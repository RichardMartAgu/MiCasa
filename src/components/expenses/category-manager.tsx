import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { Palette, Radius, Spacing } from '@/constants/theme';
import type { Category } from '@/lib/types';
import { validateBudget, validateTitle } from '@/lib/validation';

export interface CategoryManagerInput {
  name: string;
  color: string;
  icon: string;
  budget: number | null;
}

interface CategoryManagerProps {
  visible: boolean;
  categories: Category[];
  editingCategory: Category | null;
  saving: boolean;
  onClose: () => void;
  onSave: (input: CategoryManagerInput) => void;
  onEdit: (category: Category) => void;
  onDelete: (id: string) => void;
}

const COLOR_OPTIONS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export function CategoryManager({
  visible,
  categories,
  editingCategory,
  saving,
  onClose,
  onSave,
  onEdit,
  onDelete,
}: CategoryManagerProps) {
  const [name, setName] = useState(editingCategory?.name ?? '');
  const [budget, setBudget] = useState(
    editingCategory?.budget != null ? String(editingCategory.budget) : '',
  );
  const [color, setColor] = useState<string>(editingCategory?.color ?? Palette.primary);
  const [errors, setErrors] = useState<{ name?: string; budget?: string }>({});

  function handleSave() {
    const nameCheck = validateTitle(name);
    const budgetCheck = validateBudget(budget ? Number(budget) : null);
    setErrors({
      name: nameCheck.valid ? undefined : nameCheck.message,
      budget: budgetCheck.valid ? undefined : budgetCheck.message,
    });
    if (!nameCheck.valid || !budgetCheck.valid) return;

    onSave({
      name,
      color,
      icon: 'pricetag',
      budget: budget ? Number(budget) : null,
    });
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>
            {editingCategory ? 'Editar sección' : 'Secciones de gasto'}
          </Text>
          <ScrollView contentContainerStyle={styles.form}>
            <TextField
              label="Nombre de la sección"
              value={name}
              onChangeText={setName}
              placeholder="P. ej. Bebé, Reformas, Comida"
              error={errors.name}
            />
            <TextField
              label="Presupuesto mensual (€)"
              value={budget}
              onChangeText={setBudget}
              keyboardType="decimal-pad"
              placeholder="Opcional"
              error={errors.budget}
            />

            <View style={styles.colorRow}>
              {COLOR_OPTIONS.map((c) => (
                <Pressable
                  key={c}
                  style={[
                    styles.colorOption,
                    { backgroundColor: c },
                    color === c && styles.colorSelected,
                  ]}
                  onPress={() => setColor(c)}
                />
              ))}
            </View>

            <Button
              title={editingCategory ? 'Guardar cambios' : 'Añadir sección'}
              onPress={handleSave}
              loading={saving}
            />

            {categories.map((c) => (
              <View key={c.id} style={styles.categoryManageRow}>
                <View style={[styles.colorDot, { backgroundColor: c.color }]} />
                <Text style={styles.categoryName}>{c.name}</Text>
                <View style={styles.rowActions}>
                  <Pressable onPress={() => onEdit(c)} hitSlop={10}>
                    <Ionicons name="pencil-outline" size={18} color={Palette.textSecondary} />
                  </Pressable>
                  <Pressable onPress={() => onDelete(c.id)} hitSlop={10}>
                    <Ionicons name="trash-outline" size={18} color={Palette.danger} />
                  </Pressable>
                </View>
              </View>
            ))}
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
  colorRow: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  colorOption: { width: 36, height: 36, borderRadius: Radius.pill },
  colorSelected: { borderWidth: 3, borderColor: Palette.text },
  categoryManageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: Palette.border,
    paddingVertical: Spacing.three,
  },
  colorDot: { width: 12, height: 12, borderRadius: 6 },
  categoryName: { fontSize: 15, fontWeight: '600', color: Palette.textStrong },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
});