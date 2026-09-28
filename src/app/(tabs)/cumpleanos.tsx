import { useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppDatePicker } from '@/components/ui/app-date-picker';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorBanner } from '@/components/ui/error-banner';
import { FilterBar } from '@/components/ui/filter-bar';
import type { FilterChipOption } from '@/components/ui/filter-chips';
import { NoCasaState } from '@/components/ui/no-casa-state';
import { Spinner } from '@/components/ui/spinner';
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
import { syncBirthdays } from '@/lib/calendar-sync';
import { confirmDialog } from '@/lib/confirm';
import { safeDate, toISODate } from '@/lib/date';
import { filterContacts } from '@/lib/filter';
import { getBirthdayChoice, scheduleBirthdays } from '@/lib/notifications';
import type { Contact } from '@/lib/types';
import { validateDate, validateOptionalText, validateTitle } from '@/lib/validation';

export default function CumpleanosScreen() {
  const { user } = useAuth();
  const { currentCasa, loading } = useCasa();
  const { data: contacts, error: contactsError } = useRealtimeCollection<Contact>(
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
  const [errors, setErrors] = useState<{
    name?: string;
    date?: string;
    relationship?: string;
    phone?: string;
  }>({});
  const [saving, setSaving] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [selectedRelationship, setSelectedRelationship] = useState('');
  const [syncing, setSyncing] = useState(false);

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

  if (loading) return <Spinner fullScreen />;

  if (!loading && !currentCasa) {
    return <NoCasaState />;
  }

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
    setBirthDate(safeDate(contact.birth_date) ?? new Date());
    setRelationship(contact.relationship ?? '');
    setPhone(contact.phone ?? '');
    setErrors({});
    setModalVisible(true);
  }

  async function rescheduleBirthdays() {
    try {
      const choice = await getBirthdayChoice();
      await scheduleBirthdays(contacts, choice);
    } catch {
      // el sync por realtime reintentará
    }
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
    void rescheduleBirthdays();
  }

  async function handleDelete(id: string) {
    const ok = await confirmDialog(
      'Eliminar contacto',
      '¿Seguro que quieres eliminar este contacto?',
      { confirmText: 'Eliminar', destructive: true },
    );
    if (!ok) return;
    const error = await removeContact(id);
    if (error) Alert.alert('Error', error.message);
    else void rescheduleBirthdays();
  }

  function handleSync() {
    if (contacts.length === 0) {
      Alert.alert('Sin contactos', 'Añade contactos primero para sincronizar sus cumpleaños.');
      return;
    }
    Alert.alert(
      'Sincronizar cumpleaños',
      `Se crearán eventos anuales en el calendario del dispositivo para ${contacts.length} contactos.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Sincronizar',
          onPress: async () => {
            setSyncing(true);
            try {
              const result = await syncBirthdays(contacts);
              const message =
                result.errors > 0
                  ? `${result.synced} sincronizados, ${result.errors} con error.`
                  : `${result.synced} cumpleaños sincronizados con el calendario.`;
              Alert.alert('Sincronización completada', message);
            } catch {
              Alert.alert('Error', 'No se pudo acceder al calendario. Revisa los permisos.');
            } finally {
              setSyncing(false);
            }
          },
        },
      ],
    );
  }

  function openInGoogleCalendar(contact: Contact) {
    if (Platform.OS === 'web') {
      const birth = safeDate(contact.birth_date);
      if (birth === null) return;
      const y = birth.getFullYear();
      const m = String(birth.getMonth() + 1).padStart(2, '0');
      const d = String(birth.getDate()).padStart(2, '0');
      const date = `${y}${m}${d}`;
      const title = encodeURIComponent(`🎂 Cumpleaños de ${contact.name}`);
      const details = encodeURIComponent(
        contact.relationship ? `Parentesco: ${contact.relationship}` : '',
      );
      const url =
        `https://calendar.google.com/calendar/render?action=TEMPLATE` +
        `&text=${title}&dates=${date}/${date}` +
        `&recur=RRULE:FREQ=YEARLY&details=${details}`;
      void Linking.openURL(url);
    }
  }

  function renderContact(contact: Contact, daysUntil?: number, age?: number) {
    const birth = safeDate(contact.birth_date);
    return (
      <Card key={contact.id} style={styles.contactCard}>
        <View style={styles.avatar}>
          <Ionicons name="person" size={20} color={Palette.primary} />
        </View>
        <View style={styles.contactInfo}>
          <Text style={styles.contactName}>{contact.name}</Text>
          <Text style={styles.cardMeta}>
            🎂 {birth !== null ? birth.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' }) : '—'}
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
            {Platform.OS === 'web' ? (
              <Pressable
                onPress={() => openInGoogleCalendar(contact)}
                hitSlop={14}
                accessibilityRole="button"
                accessibilityLabel={`Añadir cumpleaños de ${contact.name} a Google Calendar`}>
                <Ionicons name="calendar-outline" size={18} color={Palette.primary} />
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => openEdit(contact)}
              hitSlop={14}
              accessibilityRole="button"
              accessibilityLabel={`Editar contacto ${contact.name}`}>
              <Ionicons name="pencil-outline" size={18} color={Palette.textSecondary} />
            </Pressable>
            <Pressable
              onPress={() => handleDelete(contact.id)}
              hitSlop={14}
              accessibilityRole="button"
              accessibilityLabel={`Eliminar contacto ${contact.name}`}>
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
        <View style={styles.headerActions}>
          <Pressable
            style={[styles.syncButton, syncing && styles.syncButtonDisabled]}
            disabled={syncing}
            accessibilityRole="button"
            accessibilityLabel="Sincronizar cumpleaños con el calendario del dispositivo"
            onPress={handleSync}>
            <Text style={styles.syncButtonLabel}>{syncing ? '…' : 'Calendario'}</Text>
            <Ionicons
              name={syncing ? 'sync' : 'calendar-outline'}
              size={16}
              color={Palette.primary}
            />
          </Pressable>
          <Pressable
            style={styles.fab}
            accessibilityRole="button"
            accessibilityLabel="Nuevo contacto"
            onPress={openAdd}>
            <Ionicons name="add" size={28} color={Palette.onPrimary} />
          </Pressable>
        </View>
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
        {contactsError ? <ErrorBanner message={contactsError} /> : null}
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
        accessibilityViewIsModal
        onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>
              {editingContactId ? 'Editar contacto' : 'Nuevo contacto'}
            </Text>
            <View style={styles.form}>
              <TextField label="Nombre" value={name} onChangeText={setName} error={errors.name} />
              <AppDatePicker
                value={birthDate}
                mode="date"
                icon="🎂"
                formatValue={toISODate}
                accessibilityLabel={`Cambiar fecha de nacimiento: ${toISODate(birthDate)}`}
                onChange={setBirthDate}
              />
              {errors.date ? (
                <Text style={styles.error} accessibilityRole="alert">
                  {errors.date}
                </Text>
              ) : null}
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  syncButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    backgroundColor: Palette.surface,
  },
  syncButtonDisabled: { opacity: 0.6 },
  syncButtonLabel: { fontSize: 13, fontWeight: '700', color: Palette.primary },
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
  error: { color: Palette.danger, fontSize: 13 },
  modalActions: { flexDirection: 'row', gap: Spacing.three, marginTop: Spacing.two },
});
