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
import { addContact, fetchContacts, removeContact } from '@/lib/api';
import { birthdayLabel, upcomingBirthdays } from '@/lib/birthdays';
import { toISODate } from '@/lib/date';
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

  const now = useMemo(() => new Date(), []);
  const upcoming = upcomingBirthdays(contacts, now, 30);
  const upcomingIds = new Set(upcoming.map((u) => u.contact.id));
  const rest = contacts.filter((c) => !upcomingIds.has(c.id));

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
    const error = await addContact({
      casa_id: currentCasa.id,
      user_id: user.id,
      name,
      birth_date: toISODate(birthDate),
      relationship: relationship.trim() || null,
      phone: phone.trim() || null,
    });
    setSaving(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    setName('');
    setRelationship('');
    setPhone('');
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
          <Ionicons name="person" size={20} color="#3c87f7" />
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
          <Pressable onPress={() => handleDelete(contact.id)} hitSlop={10}>
            <Ionicons name="trash-outline" size={18} color="#dc2626" />
          </Pressable>
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
        <Pressable style={styles.fab} onPress={() => setModalVisible(true)}>
          <Ionicons name="add" size={28} color="#ffffff" />
        </Pressable>
      </View>

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
            <Text style={styles.modalTitle}>Nuevo contacto</Text>
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
                <Button title="Guardar" onPress={handleSave} loading={saving} />
              </View>
            </View>
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
  contactCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e8f0fe',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactInfo: { flex: 1, gap: 2 },
  contactName: { fontSize: 16, fontWeight: '700', color: '#111827' },
  cardMeta: { fontSize: 13, color: '#6b7280' },
  contactRight: { alignItems: 'flex-end', gap: Spacing.two },
  days: {
    fontSize: 13,
    fontWeight: '700',
    color: '#3c87f7',
    backgroundColor: '#e8f0fe',
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden',
  },
  daysSoon: { color: '#dc2626', backgroundColor: '#fee2e2' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modal: {
    backgroundColor: '#fff',
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    padding: Spacing.four,
  },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: Spacing.three },
  form: { gap: Spacing.three },
  dateButton: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  dateButtonLabel: { fontSize: 15, fontWeight: '600', color: '#374151' },
  error: { color: '#dc2626', fontSize: 13 },
  modalActions: { flexDirection: 'row', gap: Spacing.three, marginTop: Spacing.two },
});
