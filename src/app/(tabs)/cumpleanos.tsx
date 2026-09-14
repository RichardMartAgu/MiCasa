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
import { FilterBar } from '@/components/ui/filter-bar';
import type { FilterChipOption } from '@/components/ui/filter-chips';
import { TextField } from '@/components/ui/text-field';
import { Palette, Radius, Shadow, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useCasa } from '@/context/casa-context';
import { useRealtimeCollection } from '@/hooks/use-realtime-collection';
import {
  addContact,
  fetchContacts,
  removeContact,
  updateContact,
} from '@/lib/api';
import { birthdayLabel, upcomingBirthdays } from '@/lib/birthdays';
import { fromISODate, toISODate } from '@/lib/date';
import { filterContacts } from '@/lib/filter';
import type { Contact } from '@/lib/types';
import { validateDate, validateOptionalText, validateTitle } from '@/lib/validation';

export default function CumpleanosScreen() {
  const { user } = useAuth();
  const { currentCasa } = useCasa();
  const { data: contacts } = useRealtimeCollection<Contact>(
    () => (currentCasa ? fetchContacts(currentCasa.id) : Promise.resolve([])),
    'contacts',
    currentCasa?.id ?? null,
  );

  const [modalVisible, setModalVisible] = useState(false);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState(new Date());
  const [relationship, setRelationship] = useState('');
  const [phone, setPhone] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [errors, setErrors] = useState<{
    name?: string;
    date?: string;
    relationship?: string;
    phone?: string;
  }>({});
  const [saving, setSaving] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [selectedRelationship, setSelectedRelationship] = useState('');

  const relationshipOptions = useMemo<FilterChipOption[]>(() => {
    const seen = new Set<string>();
    const values: FilterChipOption[] = [{ label: 'Todos', value: '' }];
    for (const c of contacts) {
      const rel = c.relationship?.trim();
      if (rel && !seen.has(rel)) {
        seen.add(rel);
        values.push({ label: rel, value: rel });
      }
    }
    return values;
  }, [contacts]);

  const visibleContacts = useMemo(
    () =>
      filterContacts(contacts, {
        search: searchText,
        relationship: selectedRelationship,
      }),
    [contacts, searchText, selectedRelationship],
  );

  const now = useMemo(() => new Date(), []);
  const upcoming = upcomingBirthdays(visibleContacts, now, 30);
  const upcomingIds = new Set(upcoming.map((u) => u.contact.id));
  const rest = visibleContacts.filter((c) => !upcomingIds.has(c.id));

  function openAdd() {
    setEditingContactId(null);
    setName('');
    setBirthDate(new Date());
    setRelationship('');
    setPhone('');
    setErrors({});
    setModalVisible(true);
  }

  function openEdit(contact: Contact) {
    setEditingContactId(contact.id);
    setName(contact.name);
    setBirthDate(fromISODate(contact.birth_date));
    setRelationship(contact.relationship ?? '');
    setPhone(contact.phone ?? '');
    setErrors({});
    setModalVisible(true);
  }

  async function handleSave() {
    const nameCheck = validateTitle(name);
    const dateCheck = validateDate(toISODate(birthDate));
    const relationshipCheck = validateOptionalText(relationship, 80);
    const phoneCheck = validateOptionalText(phone, 30);
    setErrors({
      name: nameCheck.valid ? undefined : nameCheck.message,
      date: dateCheck.valid ? undefined : dateCheck.message,
      relationship: relationshipCheck.valid ? undefined : relationshipCheck.message,
      phone: phoneCheck.valid ? undefined : phoneCheck.message,
    });
    if (
      !nameCheck.valid ||
      !dateCheck.valid ||
      !relationshipCheck.valid ||
      !phoneCheck.valid ||
      !currentCasa ||
      !user
    )
      return;

    setSaving(true);
    const input = {
      name,
      birth_date: toISODate(birthDate),
      relationship: relationship.trim() || null,
      phone: phone.trim() || null,
    };
    const error = editingContactId
      ? await updateContact(editingContactId, input)
      : await addContact({ ...input, casa_id: currentCasa.id, user_id: user.id });
    setSaving(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    setName('');
    setRelationship('');
    setPhone('');
    setEditingContactId(null);
    setModalVisible(false);
  }

  function handleDelete(id: string) {
    Alert.alert('Eliminar contacto', '¿Seguro que quieres eliminar este contacto?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          const error = await removeContact(id);
          if (error) Alert.alert('Error', error.message);
        },
      },
    ]);
  }

  function renderContact(contact: Contact, daysUntil?: number, age?: number) {
    const birth = new Date(contact.birth_date + 'T00:00:00');
    return (
      <Card key={contact.id} style={styles.contactCard}>
        <View style={styles.avatar}>
          <Ionicons name="person" size={20} color={Palette.primary} />
        </View>
        <View style={styles.contactInfo}>
          <Text style={styles.contactName}>{contact.name}</Text>
          <Text style={styles.cardMeta}>
            🎂 {birth.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}
            {age !== undefined ? ` · cumple ${age}` : ''}
          </Text>
          {contact.relationship ? (
            <Text style={styles.cardMeta}>👪 {contact.relationship}</Text>
          ) : null}
          {contact.phone ? <Text style={styles.cardMeta}>📞 {contact.phone}</Text> : null}
        </View>
        <View style={styles.contactRight}>
          {daysUntil !== undefined ? (
            <Text style={[styles.days, daysUntil <= 7 && styles.daysSoon]}>
              {birthdayLabel(daysUntil)}
            </Text>
          ) : null}
          <View style={styles.contactActions}>
            <Pressable onPress={() => openEdit(contact)} hitSlop={10}>
              <Ionicons name="pencil-outline" size={18} color={Palette.textSecondary} />
            </Pressable>
            <Pressable onPress={() => handleDelete(contact.id)} hitSlop={10}>
              <Ionicons name="trash-outline" size={18} color={Palette.danger} />
            </Pressable>
          </View>
        </View>
      </Card>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Cumpleaños</Text>
          <Text style={styles.subtitle}>Nunca más olvides una fecha</Text>
        </View>
        <Pressable style={styles.fab} onPress={openAdd}>
          <Ionicons name="add" size={28} color={Palette.onPrimary} />
        </Pressable>
      </View>

      <FilterBar
        style={styles.filterBar}
        search={{ value: searchText, onChangeText: setSearchText, placeholder: 'Buscar contactos' }}
        chips={{
          options: relationshipOptions,
          selected: selectedRelationship,
          onSelect: (value) => {
            if (typeof value === 'string') setSelectedRelationship(value);
          },
        }}
      />

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>Próximos 30 días</Text>
        {upcoming.length === 0 ? (
          <EmptyState
            icon="gift-outline"
            title="Sin cumpleaños próximos"
            subtitle="Añade contactos para recibir avisos."
          />
        ) : (
          upcoming.map((u) => renderContact(u.contact, u.daysUntil, u.age))
        )}

        {rest.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Todos los contactos</Text>
            {rest.map((c) => renderContact(c))}
          </>
        ) : null}
      </ScrollView>

      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>
              {editingContactId ? 'Editar contacto' : 'Nuevo contacto'}
            </Text>
            <View style={styles.form}>
              <TextField label="Nombre" value={name} onChangeText={setName} error={errors.name} />
              <Pressable style={styles.dateButton} onPress={() => setShowDatePicker(true)}>
                <Text style={styles.dateButtonLabel}>🎂 {toISODate(birthDate)}</Text>
              </Pressable>
              {errors.date ? <Text style={styles.error}>{errors.date}</Text> : null}
              {showDatePicker && (
                <DateTimePicker
                  value={birthDate}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(_, selected) => {
                    setShowDatePicker(false);
                    if (selected) setBirthDate(selected);
                  }}
                />
              )}
              <TextField
                label="Parentesco"
                value={relationship}
                onChangeText={setRelationship}
                placeholder="P. ej. Hijo/a, Mamá…"
                error={errors.relationship}
              />
              <TextField
                label="Teléfono"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                placeholder="Opcional"
                error={errors.phone}
              />
              <View style={styles.modalActions}>
                <Button title="Cancelar" variant="secondary" onPress={() => setModalVisible(false)} />
                <Button
                  title={editingContactId ? 'Guardar cambios' : 'Guardar'}
                  onPress={handleSave}
                  loading={saving}
                />
              </View>
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
  filterBar: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.three },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: Palette.text, marginTop: Spacing.two },
  contactCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    backgroundColor: Palette.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactInfo: { flex: 1, gap: 2 },
  contactName: { fontSize: 16, fontWeight: '700', color: Palette.text },
  cardMeta: { fontSize: 13, color: Palette.textSecondary },
  contactRight: { alignItems: 'flex-end', gap: Spacing.two },
  contactActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  days: {
    fontSize: 13,
    fontWeight: '700',
    color: Palette.primary,
    backgroundColor: Palette.primarySoft,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  daysSoon: { color: Palette.danger, backgroundColor: Palette.dangerSoft },
  modalOverlay: { flex: 1, backgroundColor: Palette.overlay, justifyContent: 'flex-end' },
  modal: {
    backgroundColor: Palette.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing.four,
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: Palette.text, marginBottom: Spacing.three },
  form: { gap: Spacing.three },
  dateButton: {
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.md,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    backgroundColor: Palette.surface,
  },
  dateButtonLabel: { fontSize: 15, fontWeight: '600', color: Palette.textStrong },
  error: { color: Palette.danger, fontSize: 13 },
  modalActions: { flexDirection: 'row', gap: Spacing.three, marginTop: Spacing.two },
});
