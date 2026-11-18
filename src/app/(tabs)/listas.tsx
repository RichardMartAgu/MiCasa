import { useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorBanner } from '@/components/ui/error-banner';
import { NoCasaState } from '@/components/ui/no-casa-state';
import { Spinner } from '@/components/ui/spinner';
import { TextField } from '@/components/ui/text-field';
import { Palette, Radius, Shadow, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useCasa } from '@/context/casa-context';
import { useRealtimeCollection } from '@/hooks/use-realtime-collection';
import {
  addShoppingItem,
  addShoppingList,
  fetchShoppingItems,
  fetchShoppingLists,
  removeShoppingItem,
  removeShoppingList,
  toggleShoppingItem,
  toggleShoppingList,
  updateShoppingItem,
} from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import { showNotice } from '@/lib/notice';
import type { ShoppingItem, ShoppingList } from '@/lib/types';
import { validateOptionalQuantity, validateTitle } from '@/lib/validation';

export default function ListasScreen() {
  const { user } = useAuth();
  const { currentCasa, loading } = useCasa();
  const { data: lists, error: listsError } = useRealtimeCollection<ShoppingList>(
    () => (currentCasa ? fetchShoppingLists(currentCasa.id) : Promise.resolve([])),
    'shopping_lists',
    currentCasa?.id ?? null,
  );

  const [expanded, setExpanded] = useState<{ casaId: string | null; listId: string | null }>({
    casaId: null,
    listId: null,
  });
  const expandedId = expanded.casaId === (currentCasa?.id ?? null) ? expanded.listId : null;

  function setExpandedId(listId: string | null) {
    setExpanded({ casaId: currentCasa?.id ?? null, listId });
  }
  const [modalVisible, setModalVisible] = useState(false);
  const [listTitle, setListTitle] = useState('');
  const [newItemName, setNewItemName] = useState('');
  const [newItemQty, setNewItemQty] = useState('');
  const casaId = currentCasa?.id ?? null;
  const [editing, setEditing] = useState<{ casaId: string | null; item: ShoppingItem | null }>({
    casaId,
    item: null,
  });
  const [editingCasaId, setEditingCasaId] = useState(casaId);
  if (editingCasaId !== casaId) {
    setEditingCasaId(casaId);
    setEditing({ casaId, item: null });
  }
  const editingItem = editing.casaId === casaId ? editing.item : null;
  const [editName, setEditName] = useState('');
  const [editQty, setEditQty] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [editQtyError, setEditQtyError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const editSavingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: items, error: itemsError } = useRealtimeCollection<ShoppingItem>(
    () => (expandedId ? fetchShoppingItems(expandedId) : Promise.resolve([])),
    'shopping_items',
    expandedId,
    expandedId ? `list_id=eq.${expandedId}` : undefined,
    'list_id',
  );

  const loadError = listsError ?? itemsError;

  if (loading) return <Spinner fullScreen />;

  if (!loading && !currentCasa) {
    return <NoCasaState />;
  }

  async function handleAddList() {
    const check = validateTitle(listTitle);
    if (!check.valid) {
      setError(check.message);
      return;
    }
    if (!currentCasa || !user) return;
    setSaving(true);
    const err = await addShoppingList({
      casa_id: currentCasa.id,
      user_id: user.id,
      title: listTitle.trim(),
    });
    setSaving(false);
    if (err) {
      showNotice('Error', err.message);
      return;
    }
    setListTitle('');
    setModalVisible(false);
  }

  async function handleAddItem(listId: string) {
    if (!currentCasa) return;
    if (!newItemName.trim()) {
      showNotice('Error', 'El nombre del artículo es obligatorio.');
      return;
    }
    const check = validateTitle(newItemName);
    if (!check.valid) {
      showNotice('Error', check.message);
      return;
    }
    const qty = validateOptionalQuantity(newItemQty);
    if (!qty.valid) {
      showNotice('Error', qty.message);
      return;
    }
    const err = await addShoppingItem({
      list_id: listId,
      casa_id: currentCasa.id,
      name: newItemName.trim(),
      quantity: qty.value,
    });
    if (err) {
      showNotice('Error', err.message);
      return;
    }
    setNewItemName('');
    setNewItemQty('');
  }

  function openEditItem(item: ShoppingItem) {
    setEditing({ casaId: currentCasa?.id ?? null, item });
    setEditName(item.name);
    setEditQty(item.quantity != null ? String(item.quantity).replace('.', ',') : '');
    setEditError(null);
    setEditQtyError(null);
  }

  async function handleSaveItem() {
    if (!editingItem || editSavingRef.current) return;
    const name = editName.trim();
    if (!name) {
      setEditError('El nombre del artículo es obligatorio.');
      return;
    }
    if (name.length > 120) {
      setEditError('El nombre no puede superar 120 caracteres.');
      return;
    }
    const check = validateTitle(editName);
    if (!check.valid) {
      setEditError(check.message);
      return;
    }
    const qty = validateOptionalQuantity(editQty);
    if (!qty.valid) {
      setEditQtyError(qty.message);
      return;
    }
    editSavingRef.current = true;
    setEditSaving(true);
    try {
      const err = await updateShoppingItem(editingItem.id, {
        name,
        quantity: qty.value,
      });
      if (err) {
        showNotice('Error', err.message);
        return;
      }
      setEditing({ casaId: currentCasa?.id ?? null, item: null });
    } finally {
      editSavingRef.current = false;
      setEditSaving(false);
    }
  }

  async function handleToggleList(id: string, done: boolean) {
    const err = await toggleShoppingList(id, done);
    if (err) showNotice('Error', err.message);
  }

  async function handleToggleItem(id: string, done: boolean) {
    const err = await toggleShoppingItem(id, done);
    if (err) showNotice('Error', err.message);
  }

  async function handleDeleteItem(id: string) {
    const err = await removeShoppingItem(id);
    if (err) showNotice('Error', err.message);
  }

  async function handleDeleteList(id: string) {
    const ok = await confirmDialog(
      'Eliminar lista',
      '¿Seguro que quieres eliminar esta lista y sus artículos?',
      { confirmText: 'Eliminar', destructive: true },
    );
    if (!ok) return;
    const err = await removeShoppingList(id);
    if (err) showNotice('Error', err.message);
    if (expandedId === id) setExpandedId(null);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Listas de la compra</Text>
          <Text style={styles.subtitle}>
            {lists.filter((l) => !l.done).length} listas abiertas
          </Text>
        </View>
        <Pressable
          style={styles.fab}
          accessibilityRole="button"
          accessibilityLabel="Nueva lista de la compra"
          onPress={() => setModalVisible(true)}>
          <Ionicons name="add" size={28} color={Palette.onPrimary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {loadError ? <ErrorBanner message={loadError} /> : null}
        {lists.length === 0 ? (
          <EmptyState
            icon="cart-outline"
            title="Sin listas todavía"
            subtitle="Crea una lista de la compra y añade artículos."
          />
        ) : (
          lists.map((list) => {
            const listItems = items.filter((i) => i.list_id === list.id);
            const doneCount = listItems.filter((i) => i.done).length;
            const isExpanded = expandedId === list.id;
            return (
              <Card key={list.id} style={[styles.listCard, list.done && styles.listDone]}>
                <View style={styles.listRow}>
                  <Pressable
                    style={styles.listBody}
                    accessibilityRole="button"
                    onPress={() => setExpandedId(isExpanded ? null : list.id)}>
                    <Text style={[styles.listTitle, list.done && styles.textMuted]}>
                      {list.title}
                    </Text>
                    <Text style={styles.cardMeta}>
                      {listItems.length > 0
                        ? `${doneCount}/${listItems.length} artículos`
                        : 'Toca para ver los artículos'}
                    </Text>
                  </Pressable>
                  <View style={styles.listActions}>
                    <Pressable
                      onPress={() => void handleToggleList(list.id, !list.done)}
                      hitSlop={14}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: list.done }}
                      accessibilityLabel={`Marcar lista ${list.title} como ${list.done ? 'pendiente' : 'completada'}`}>
                      <Ionicons
                        name={list.done ? 'checkmark-circle' : 'ellipse-outline'}
                        size={24}
                        color={list.done ? Palette.success : Palette.textMuted}
                      />
                    </Pressable>
                    <Pressable
                      onPress={() => handleDeleteList(list.id)}
                      hitSlop={14}
                      accessibilityRole="button"
                      accessibilityLabel={`Eliminar lista ${list.title}`}>
                      <Ionicons name="trash-outline" size={20} color={Palette.danger} />
                    </Pressable>
                  </View>
                </View>

                {isExpanded ? (
                  <View style={styles.itemSection}>
                    {listItems.map((item) => (
                      <View key={item.id} style={styles.itemRow}>
                        <Pressable
                          onPress={() => void handleToggleItem(item.id, !item.done)}
                          hitSlop={14}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: item.done }}
                          accessibilityLabel={`Marcar artículo ${item.name} como ${item.done ? 'pendiente' : 'comprado'}`}>
                          <Ionicons
                            name={item.done ? 'checkbox' : 'square-outline'}
                            size={22}
                            color={item.done ? Palette.success : Palette.textMuted}
                          />
                        </Pressable>
                        <Text style={[styles.itemName, item.done && styles.textMuted]}>
                          {item.name}
                          {item.quantity ? ` · ${String(item.quantity).replace('.', ',')}${item.unit ? ` ${item.unit}` : ''}` : ''}
                        </Text>
                        <Pressable
                          onPress={() => openEditItem(item)}
                          hitSlop={14}
                          accessibilityRole="button"
                          accessibilityLabel={`Editar artículo ${item.name}`}>
                          <Ionicons name="pencil-outline" size={18} color={Palette.textMuted} />
                        </Pressable>
                        <Pressable
                          onPress={() => void handleDeleteItem(item.id)}
                          hitSlop={14}
                          accessibilityRole="button"
                          accessibilityLabel={`Quitar artículo ${item.name}`}>
                          <Ionicons name="close-circle-outline" size={20} color={Palette.textMuted} />
                        </Pressable>
                      </View>
                    ))}

                    <View style={styles.addItemRow}>
                      <TextInput
                        style={styles.itemInput}
                        placeholder="Nuevo artículo"
                        placeholderTextColor={Palette.textMuted}
                        accessibilityLabel="Nuevo artículo"
                        value={newItemName}
                        onChangeText={setNewItemName}
                        onSubmitEditing={() => handleAddItem(list.id)}
                        returnKeyType="done"
                      />
                      <TextInput
                        style={[styles.itemInput, styles.qtyInput]}
                        placeholder="Cant."
                        placeholderTextColor={Palette.textMuted}
                        accessibilityLabel="Cantidad"
                        value={newItemQty}
                        onChangeText={setNewItemQty}
                        keyboardType="decimal-pad"
                      />
                      <Pressable
                        style={styles.addItemButton}
                        accessibilityRole="button"
                        accessibilityLabel="Añadir artículo"
                        onPress={() => handleAddItem(list.id)}>
                        <Ionicons name="add" size={22} color={Palette.onPrimary} />
                      </Pressable>
                    </View>
                  </View>
                ) : null}
              </Card>
            );
          })
        )}
      </ScrollView>

      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        accessibilityViewIsModal
        onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Nueva lista</Text>
            <TextField
              label="Nombre de la lista"
              value={listTitle}
              onChangeText={setListTitle}
              placeholder="P. ej. Supermercado"
              error={error}
            />
            <View style={styles.modalActions}>
              <Button title="Cancelar" variant="secondary" onPress={() => setModalVisible(false)} />
              <Button title="Crear" onPress={handleAddList} loading={saving} />
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={editingItem !== null}
        animationType="slide"
        transparent
        accessibilityViewIsModal
        onRequestClose={() => {
          if (!editSaving) setEditing({ casaId: currentCasa?.id ?? null, item: null });
        }}>
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Editar artículo</Text>
            <TextField
              label="Nombre del artículo"
              value={editName}
              onChangeText={(value) => {
                setEditName(value);
                if (editError) setEditError(null);
              }}
              placeholder="P. ej. Leche"
              error={editError}
            />
            <View style={styles.editQtyRow}>
              <Text style={styles.editQtyLabel}>Cantidad</Text>
              <TextInput
                style={[styles.itemInput, styles.editQtyInput]}
                placeholder="Opcional"
                placeholderTextColor={Palette.textMuted}
                accessibilityLabel="Cantidad del artículo"
                value={editQty}
                onChangeText={(value) => {
                  setEditQty(value);
                  if (editQtyError) setEditQtyError(null);
                }}
                keyboardType="decimal-pad"
                onSubmitEditing={() => void handleSaveItem()}
                returnKeyType="done"
              />
              {editQtyError ? <Text style={styles.editQtyError}>{editQtyError}</Text> : null}
            </View>
            <View style={styles.modalActions}>
              <Button
                title="Cancelar"
                variant="secondary"
                disabled={editSaving}
                onPress={() => setEditing({ casaId: currentCasa?.id ?? null, item: null })}
              />
              <Button title="Guardar" onPress={handleSaveItem} loading={editSaving} />
            </View>
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
  content: { paddingHorizontal: Spacing.four, gap: Spacing.three, paddingBottom: Spacing.six },
  listCard: { gap: Spacing.three },
  listDone: { opacity: 0.6 },
  listRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  listBody: { flex: 1, gap: Spacing.one },
  listTitle: { fontSize: 16, fontWeight: '700', color: Palette.text },
  listActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  cardMeta: { fontSize: 13, color: Palette.textSecondary },
  textMuted: { textDecorationLine: 'line-through', color: Palette.textMuted },
  itemSection: {
    gap: Spacing.two,
    borderTopWidth: 1,
    borderTopColor: Palette.border,
    paddingTop: Spacing.three,
  },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  itemName: { flex: 1, fontSize: 15, color: Palette.textStrong },
  addItemRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center', marginTop: Spacing.two },
  itemInput: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 15,
    color: Palette.text,
    backgroundColor: Palette.surface,
  },
  qtyInput: { flex: 0.4, flexShrink: 1, minWidth: 0 },
  addItemButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    backgroundColor: Palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOverlay: { flex: 1, backgroundColor: Palette.overlay, justifyContent: 'flex-end' },
  modal: {
    backgroundColor: Palette.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: Palette.text },
  editQtyRow: { gap: Spacing.one },
  editQtyLabel: { fontSize: 14, fontWeight: '600', color: Palette.textSecondary },
  editQtyInput: { flex: 0, minWidth: 0 },
  editQtyError: { fontSize: 13, color: Palette.danger },
  modalActions: { flexDirection: 'row', gap: Spacing.three, marginTop: Spacing.two },
});
