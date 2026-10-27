import { useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppDatePicker } from '@/components/ui/app-date-picker';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { FridgeList } from '@/components/ui/fridge-list';
import { NoCasaState } from '@/components/ui/no-casa-state';
import { Spinner } from '@/components/ui/spinner';
import { TextField } from '@/components/ui/text-field';
import { Palette, Radius, Shadow, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useCasa } from '@/context/casa-context';
import { useRealtimeCollection } from '@/hooks/use-realtime-collection';
import {
  addFridgeItem,
  fetchFridgeItems,
  removeFridgeItem,
  toggleFridgeItem,
  updateFridgeItem,
} from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import { showNotice } from '@/lib/notice';
import { startOfDay, toISODate } from '@/lib/date';
import { fridgeDaysLeft } from '@/lib/fridge';
import { getFridgeChoice, scheduleFridgeItem, cancelEntityKey } from '@/lib/notifications';
import type { FridgeItem } from '@/lib/types';
import {
  isValidNotifyAudience,
  notifyAudienceLabels,
  notifyAudiences,
  type NotifyAudience,
} from '@/lib/notification-audience';
import { validateTitle } from '@/lib/validation';

function defaultExpiry(): Date {
  const date = new Date();
  date.setDate(date.getDate() + 3);
  return date;
}

function parseQuantity(raw: string): number | null {
  const value = Number(raw.replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export default function NeveraScreen() {
  const { user } = useAuth();
  const { currentCasa, loading } = useCasa();
  const { data: items, error } = useRealtimeCollection<FridgeItem>(
    () => (currentCasa ? fetchFridgeItems(currentCasa.id) : Promise.resolve([])),
    'fridge_items',
    currentCasa?.id ?? null,
  );

  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [expiry, setExpiry] = useState<Date>(defaultExpiry);
  const [notifyAudience, setNotifyAudience] = useState<NotifyAudience>('me');
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [minExpiry, setMinExpiry] = useState(() => startOfDay(new Date()));

  const sorted = useMemo(() => {
    return [...items].sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return a.expiry_date.localeCompare(b.expiry_date);
    });
  }, [items]);

  const expiringSoon = items.filter((item) => {
    const days = fridgeDaysLeft(item.expiry_date);
    return !item.done && days !== null && days >= 0 && days <= 2;
  }).length;

  if (loading) return <Spinner fullScreen />;
  if (!loading && !currentCasa) return <NoCasaState />;

  function openCreate() {
    setEditingId(null);
    setName('');
    setQuantity('');
    setUnit('');
    setExpiry(defaultExpiry());
    setMinExpiry(startOfDay(new Date()));
    setNotifyAudience('me');
    setNameError(null);
    setModalVisible(true);
  }

  function openEdit(item: FridgeItem) {
    setEditingId(item.id);
    setName(item.name);
    setQuantity(item.quantity !== null && item.quantity !== undefined ? String(item.quantity) : '');
    setUnit(item.unit ?? '');
    setExpiry(new Date(`${item.expiry_date}T00:00:00`));
    setMinExpiry(startOfDay(new Date()));
    setNotifyAudience(
      isValidNotifyAudience(item.notify_audience) ? item.notify_audience : 'me',
    );
    setNameError(null);
    setModalVisible(true);
  }

  async function scheduleIfNative(item: FridgeItem) {
    if (Platform.OS === 'web') return;
    if (item.done) {
      await cancelEntityKey('fridge', item.id);
      return;
    }
    const choice = await getFridgeChoice();
    if (choice === 'none') return;
    await scheduleFridgeItem(item, choice, user?.id);
  }

  async function handleSave() {
    if (!currentCasa) return;
    const check = validateTitle(name);
    if (!check.valid) {
      setNameError(check.message);
      return;
    }
    const input = {
      name: name.trim(),
      expiry_date: toISODate(expiry),
      quantity: parseQuantity(quantity),
      unit: unit.trim() || null,
      notify_audience: notifyAudience,
    };
    setSaving(true);
    const result = editingId
      ? await updateFridgeItem(editingId, input)
      : await addFridgeItem({ ...input, casa_id: currentCasa.id });
    setSaving(false);
    if (result.error) {
      showNotice('Error', result.error.message);
      return;
    }
    setModalVisible(false);
    if (result.data) await scheduleIfNative(result.data);
  }

  async function handleToggle(item: FridgeItem) {
    const errorResult = await toggleFridgeItem(item.id, !item.done);
    if (errorResult) {
      showNotice('Error', errorResult.message);
      return;
    }
    if (item.done) {
      await scheduleIfNative({ ...item, done: false });
    } else {
      await cancelEntityKey('fridge', item.id);
    }
  }

  async function handleDelete(item: FridgeItem) {
    const ok = await confirmDialog(
      'Eliminar de la nevera',
      `¿Seguro que quieres eliminar «${item.name}»?`,
      { confirmText: 'Eliminar', destructive: true },
    );
    if (!ok) return;
    const errorResult = await removeFridgeItem(item.id);
    if (errorResult) {
      showNotice('Error', errorResult.message);
      return;
    }
    await cancelEntityKey('fridge', item.id);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Nevera</Text>
          <Text style={styles.subtitle}>
            {expiringSoon > 0
              ? `${expiringSoon} ${expiringSoon === 1 ? 'producto caduca' : 'productos caducan'} pronto`
              : `${items.filter((i) => !i.done).length} productos en la nevera`}
          </Text>
        </View>
        <Pressable
          style={styles.fab}
          accessibilityRole="button"
          accessibilityLabel="Añadir producto a la nevera"
          onPress={openCreate}>
          <Ionicons name="add" size={28} color={Palette.onPrimary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {error ? <ErrorBanner message={error} /> : null}
        <FridgeList
          items={sorted}
          onToggle={(item) => void handleToggle(item)}
          onPress={openEdit}
          onDelete={(item) => void handleDelete(item)}
        />
      </ScrollView>

      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        accessibilityViewIsModal
        onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {editingId ? 'Editar producto' : 'Nuevo producto'}
            </Text>
            <TextField
              label="Producto"
              value={name}
              onChangeText={setName}
              placeholder="P. ej. Leche"
              error={nameError}
            />
            <View style={styles.row}>
              <TextInput
                style={[styles.input, styles.flex]}
                placeholder="Cantidad"
                placeholderTextColor={Palette.textMuted}
                accessibilityLabel="Cantidad"
                keyboardType="decimal-pad"
                value={quantity}
                onChangeText={setQuantity}
              />
              <TextInput
                style={[styles.input, styles.flex]}
                placeholder="Unidad"
                placeholderTextColor={Palette.textMuted}
                accessibilityLabel="Unidad"
                maxLength={32}
                value={unit}
                onChangeText={setUnit}
              />
            </View>
            <Text style={styles.fieldLabel}>Fecha de caducidad</Text>
            <AppDatePicker
              value={expiry}
              mode="date"
              onChange={setExpiry}
              icon="📅"
              formatValue={(date) => toISODate(date)}
              accessibilityLabel={`Fecha de caducidad: ${toISODate(expiry)}`}
              min={minExpiry}
            />
            <Text style={styles.fieldLabel}>Avisar a</Text>
            <View style={styles.audienceRow}>
              {notifyAudiences.map((value) => (
                <Pressable
                  key={value}
                  style={[styles.chip, notifyAudience === value && styles.chipSelected]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: notifyAudience === value }}
                  onPress={() => setNotifyAudience(value)}>
                  <Text
                    style={[styles.chipText, notifyAudience === value && styles.chipTextSelected]}>
                    {notifyAudienceLabels[value]}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.modalActions}>
              <Button
                title="Cancelar"
                variant="secondary"
                onPress={() => setModalVisible(false)}
              />
              <Button
                title={editingId ? 'Guardar' : 'Añadir'}
                onPress={() => void handleSave()}
                loading={saving}
              />
            </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  fab: {
    width: 48,
    height: 48,
    borderRadius: Radius.pill,
    backgroundColor: Palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.fab,
  },
  content: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  modal: {
    backgroundColor: Palette.background,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    padding: Spacing.four,
    maxHeight: '90%',
  },
  modalContent: { gap: Spacing.three },
  modalTitle: { fontSize: 20, fontWeight: '700', color: Palette.text },
  row: { flexDirection: 'row', gap: Spacing.two },
  flex: { flex: 1, minWidth: 0 },
  input: {
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 15,
    color: Palette.text,
    backgroundColor: Palette.surface,
  },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: Palette.textStrong },
  audienceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
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
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.two },
});
