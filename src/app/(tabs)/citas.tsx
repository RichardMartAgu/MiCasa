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
import { addAppointment, fetchAppointments, removeAppointment } from '@/lib/api';
import { formatDateTime } from '@/lib/date';
import type { Appointment, AppointmentKind } from '@/lib/types';
import { validateDate, validateOptionalText, validateTitle } from '@/lib/validation';

const KINDS: { value: AppointmentKind; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'medico', label: 'Médico', icon: 'medkit-outline' },
  { value: 'escuela', label: 'Escuela', icon: 'school-outline' },
  { value: 'mascota', label: 'Mascota', icon: 'paw-outline' },
  { value: 'personal', label: 'Personal', icon: 'person-outline' },
  { value: 'otro', label: 'Otro', icon: 'ellipsis-horizontal-outline' },
];

function toISOLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

export default function CitasScreen() {
  const { user } = useAuth();
  const { currentCasa } = useCasa();
  const { data: appointments } = useRealtimeCollection<Appointment>(
    () => (currentCasa ? fetchAppointments(currentCasa.id) : Promise.resolve([])),
    'appointments',
    currentCasa?.id ?? null,
  );

  const [modalVisible, setModalVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<AppointmentKind>('medico');
  const [person, setPerson] = useState('');
  const [location, setLocation] = useState('');
  const [date, setDate] = useState(new Date());
  const [time, setTime] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [errors, setErrors] = useState<{
    title?: string;
    date?: string;
    person?: string;
    location?: string;
  }>({});
  const [saving, setSaving] = useState(false);

  const now = useMemo(() => new Date(), []);
  const upcoming = appointments
    .filter((a) => new Date(a.starts_at) >= now)
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  const past = appointments
    .filter((a) => new Date(a.starts_at) < now)
    .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());

  async function handleSave() {
    const startsAt = toISOLocal(
      new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        time.getHours(),
        time.getMinutes(),
      ),
    );
    const titleCheck = validateTitle(title);
    const dateCheck = validateDate(startsAt);
    const personCheck = validateOptionalText(person, 120);
    const locationCheck = validateOptionalText(location, 120);
    setErrors({
      title: titleCheck.valid ? undefined : titleCheck.message,
      date: dateCheck.valid ? undefined : dateCheck.message,
      person: personCheck.valid ? undefined : personCheck.message,
      location: locationCheck.valid ? undefined : locationCheck.message,
    });
    if (
      !titleCheck.valid ||
      !dateCheck.valid ||
      !personCheck.valid ||
      !locationCheck.valid ||
      !currentCasa ||
      !user
    )
      return;

    setSaving(true);
    const error = await addAppointment({
      casa_id: currentCasa.id,
      user_id: user.id,
      title,
      kind,
      person: person.trim() || null,
      location: location.trim() || null,
      starts_at: startsAt,
    });
    setSaving(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    setTitle('');
    setPerson('');
    setLocation('');
    setModalVisible(false);
  }

  async function handleDelete(id: string) {
    if (!currentCasa) return;
    Alert.alert('Eliminar cita', '¿Seguro que quieres eliminar esta cita?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          const error = await removeAppointment(id);
          if (error) Alert.alert('Error', error.message);
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Citas</Text>
          <Text style={styles.subtitle}>Médico, escuela, mascotas y más</Text>
        </View>
        <Pressable style={styles.fab} onPress={() => setModalVisible(true)}>
          <Ionicons name="add" size={28} color="#ffffff" />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>Próximas</Text>
        {upcoming.length === 0 ? (
          <EmptyState
            icon="calendar-outline"
            title="Sin citas próximas"
            subtitle="Pulsa el botón + para crear una nueva cita."
          />
        ) : (
          upcoming.map((a) => (
            <Card key={a.id}>
              <View style={styles.cardRow}>
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle}>{a.title}</Text>
                  <Text style={styles.cardMeta}>{formatDateTime(a.starts_at)}</Text>
                  {a.person ? <Text style={styles.cardMeta}>👤 {a.person}</Text> : null}
                  {a.location ? <Text style={styles.cardMeta}>📍 {a.location}</Text> : null}
                </View>
                <Pressable onPress={() => handleDelete(a.id)} hitSlop={12}>
                  <Ionicons name="trash-outline" size={20} color="#dc2626" />
                </Pressable>
              </View>
            </Card>
          ))
        )}

        {past.length > 0 ? (
          <>
            <Text style={[styles.sectionTitle, styles.pastTitle]}>Anteriores</Text>
            {past.slice(0, 10).map((a) => (
              <View key={a.id} style={styles.pastRow}>
                <Text style={styles.pastTitle}>{a.title}</Text>
                <Text style={styles.cardMeta}>{formatDateTime(a.starts_at)}</Text>
              </View>
            ))}
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
            <Text style={styles.modalTitle}>Nueva cita</Text>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
              <TextField
                label="Título"
                value={title}
                onChangeText={setTitle}
                placeholder="P. ej. Pediatría de Leo"
                error={errors.title}
              />

              <View style={styles.kindRow}>
                {KINDS.map((k) => (
                  <Pressable
                    key={k.value}
                    style={[styles.chip, kind === k.value && styles.chipSelected]}
                    onPress={() => setKind(k.value)}>
                    <Ionicons
                      name={k.icon}
                      size={16}
                      color={kind === k.value ? '#fff' : '#6b7280'}
                    />
                    <Text style={[styles.chipText, kind === k.value && styles.chipTextSelected]}>
                      {k.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <TextField
                label="Persona"
                value={person}
                onChangeText={setPerson}
                placeholder="¿Con quién es la cita?"
                error={errors.person}
              />
              <TextField
                label="Lugar"
                value={location}
                onChangeText={setLocation}
                placeholder="Consulta, hospital…"
                error={errors.location}
              />

              <View style={styles.dateRow}>
                <Pressable style={styles.dateButton} onPress={() => setShowDatePicker(true)}>
                  <Text style={styles.dateButtonLabel}>
                    📅 {date.toLocaleDateString('es-ES')}
                  </Text>
                </Pressable>
                <Pressable style={styles.dateButton} onPress={() => setShowTimePicker(true)}>
                  <Text style={styles.dateButtonLabel}>
                    🕐 {time.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </Pressable>
              </View>
              {errors.date ? <Text style={styles.error}>{errors.date}</Text> : null}

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
              {showTimePicker && (
                <DateTimePicker
                  value={time}
                  mode="time"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(_, selected) => {
                    setShowTimePicker(false);
                    if (selected) setTime(selected);
                  }}
                />
              )}

              <View style={styles.modalActions}>
                <Button
                  title="Cancelar"
                  variant="secondary"
                  onPress={() => setModalVisible(false)}
                />
                <Button title="Guardar" onPress={handleSave} loading={saving} />
              </View>
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
  pastTitle: { fontSize: 14, color: '#6b7280' },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.three },
  cardBody: { gap: Spacing.one, flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  cardMeta: { fontSize: 13, color: '#6b7280' },
  pastRow: { flexDirection: 'row', justifyContent: 'space-between' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: '#fff',
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    padding: Spacing.four,
    maxHeight: '92%',
  },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: Spacing.three },
  form: { gap: Spacing.three },
  kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
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
  dateRow: { flexDirection: 'row', gap: Spacing.two },
  dateButton: {
    flex: 1,
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
