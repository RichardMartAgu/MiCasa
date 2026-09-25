import { useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  Alert,
  Modal,
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
import { IconPicker } from '@/components/ui/icon-picker';
import { NoCasaState } from '@/components/ui/no-casa-state';
import { Spinner } from '@/components/ui/spinner';
import { TextField } from '@/components/ui/text-field';
import { Palette, Radius, Shadow, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useCasa } from '@/context/casa-context';
import { useRealtimeCollection } from '@/hooks/use-realtime-collection';
import {
  APPOINTMENT_ICON_OPTIONS,
  type AppointmentIcon,
  DEFAULT_APPOINTMENT_ICON,
  resolveAppointmentIcon,
} from '@/lib/appointment-icons';
import {
  addAppointment,
  addAppointmentKind,
  fetchAppointments,
  fetchAppointmentKinds,
  removeAppointment,
  removeAppointmentKind,
  updateAppointment,
  updateAppointmentKind,
} from '@/lib/api';
import { formatDateTime } from '@/lib/date';
import { filterAppointments } from '@/lib/filter';
import { confirmDialog } from '@/lib/confirm';
import {
  appointmentReminderDates,
  reminderChoiceLabels,
  reminderChoices,
  type ReminderChoice,
} from '@/lib/notification-schedule';
import {
  areNotificationsEnabled,
  askEnableNotifications,
  cancelEntityKey,
  scheduleAppointment,
} from '@/lib/notifications';
import type { Appointment, AppointmentKindRow } from '@/lib/types';
import { validateDate, validateOptionalText, validateTitle } from '@/lib/validation';

const DEFAULT_KINDS: { name: string; icon: AppointmentIcon }[] = [
  { name: 'medico', icon: 'medkit-outline' },
  { name: 'escuela', icon: 'school-outline' },
  { name: 'personal', icon: 'person-outline' },
  { name: 'otro', icon: 'ellipsis-horizontal-outline' },
];

type KindUI = {
  id: string | null;
  name: string;
  icon: AppointmentIcon;
};

function toISOLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

export default function CitasScreen() {
  const { user } = useAuth();
  const { currentCasa, loading } = useCasa();
  const { data: appointments, error: appointmentsError } = useRealtimeCollection<Appointment>(
    () => (currentCasa ? fetchAppointments(currentCasa.id) : Promise.resolve([])),
    'appointments',
    currentCasa?.id ?? null,
  );
  const { data: kinds } = useRealtimeCollection<AppointmentKindRow>(
    () => (currentCasa ? fetchAppointmentKinds(currentCasa.id) : Promise.resolve([])),
    'appointment_kinds',
    currentCasa?.id ?? null,
  );
  const kindRows: KindUI[] =
    kinds && kinds.length > 0
      ? kinds.map((k) => ({
          id: k.id,
          name: k.name,
          icon: resolveAppointmentIcon(k.icon),
        }))
      : DEFAULT_KINDS.map((d) => ({ id: null, name: d.name, icon: d.icon }));

  const [modalVisible, setModalVisible] = useState(false);
  const [editingAppointmentId, setEditingAppointmentId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('medico');
  const [person, setPerson] = useState('');
  const [location, setLocation] = useState('');
  const [date, setDate] = useState(new Date());
  const [time, setTime] = useState(new Date());
  const [reminderChoice, setReminderChoice] = useState<ReminderChoice>('none');
  const [errors, setErrors] = useState<{
    title?: string;
    date?: string;
    person?: string;
    location?: string;
  }>({});
  const [saving, setSaving] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [selectedKind, setSelectedKind] = useState('');

  const [kindsModalVisible, setKindsModalVisible] = useState(false);
  const [editingKindId, setEditingKindId] = useState<string | null>(null);
  const [kindName, setKindName] = useState('');
  const [kindIcon, setKindIcon] = useState<AppointmentIcon>(DEFAULT_APPOINTMENT_ICON);
  const [kindError, setKindError] = useState<string | null>(null);
  const [kindSaving, setKindSaving] = useState(false);

  const kindOptions = useMemo<FilterChipOption[]>(
    () => [
      { label: 'Todos', value: '' },
      ...kindRows.map((k) => ({ label: k.name, value: k.name })),
    ],
    [kindRows],
  );

  const visibleAppointments = useMemo(
    () => filterAppointments(appointments, { search: searchText, kind: selectedKind }),
    [appointments, searchText, selectedKind],
  );

  const now = useMemo(() => new Date(), []);
  const upcoming = visibleAppointments
    .filter((a) => new Date(a.starts_at) >= now)
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  const past = visibleAppointments
    .filter((a) => new Date(a.starts_at) < now)
    .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());

  if (loading) return <Spinner fullScreen />;

  if (!loading && !currentCasa) {
    return <NoCasaState />;
  }

  function openAdd() {
    setEditingAppointmentId(null);
    setTitle('');
    setKind(kindRows[0]?.name ?? 'medico');
    setPerson('');
    setLocation('');
    setDate(new Date());
    setTime(new Date());
    setReminderChoice('none');
    setErrors({});
    setModalVisible(true);
  }

  function openEdit(appointment: Appointment) {
    setEditingAppointmentId(appointment.id);
    setTitle(appointment.title);
    setKind(appointment.kind);
    setPerson(appointment.person ?? '');
    setLocation(appointment.location ?? '');
    setReminderChoice(
      reminderChoices.includes(appointment.reminder_choice as ReminderChoice)
        ? (appointment.reminder_choice as ReminderChoice)
        : 'none',
    );
    const parsed = new Date(appointment.starts_at);
    if (!Number.isNaN(parsed.getTime())) {
      setDate(new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
      setTime(
        new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), parsed.getHours(), parsed.getMinutes()),
      );
    }
    setErrors({});
    setModalVisible(true);
  }

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
    const { reminderAtRaw, choice } = appointmentReminderDates(
      new Date(date.getFullYear(), date.getMonth(), date.getDate(), time.getHours(), time.getMinutes()),
      reminderChoice,
    );
    const input = {
      title,
      kind,
      person: person.trim() || null,
      location: location.trim() || null,
      starts_at: startsAt,
      reminder_at: reminderAtRaw,
      reminder_choice: choice,
    };
    let error: { message: string } | null = null;
    let saved: Appointment | null = null;
    if (editingAppointmentId) {
      error = await updateAppointment(editingAppointmentId, input);
      const base = appointments.find((a) => a.id === editingAppointmentId);
      if (!error && base) saved = { ...base, ...input };
    } else {
      const result = await addAppointment({ ...input, casa_id: currentCasa.id, user_id: user.id });
      error = result.error;
      saved = result.data ?? null;
    }
    setSaving(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    // Cerrar el modal antes de tocar notificaciones: el aviso de permisos se
    // presenta en una ventana distinta y, con el Modal abierto en Android,
    // quedaba detrás (invisible) y su Promise sin resolver bloqueaba el guardado.
    setTitle('');
    setPerson('');
    setLocation('');
    setEditingAppointmentId(null);
    setModalVisible(false);

    if (saved) {
      void scheduleAppointmentAfterSave(saved, reminderChoice);
    }
  }

  // El agendado nunca debe bloquear el guardado: se ejecuta en segundo plano
  // y cualquier fallo lo absorbe el sync por realtime.
  async function scheduleAppointmentAfterSave(
    appointment: Appointment,
    choice: ReminderChoice,
  ): Promise<void> {
    try {
      if (choice !== 'none' && !(await areNotificationsEnabled())) {
        const result = await askEnableNotifications(
          'Esta cita tiene recordatorio, pero las notificaciones están apagadas. No recibirás el aviso.',
        );
        if (result === 'enabled') {
          await scheduleAppointment(appointment, choice);
        }
        return;
      }
      await scheduleAppointment(appointment, choice);
    } catch {
      // el sync por realtime reintentará
    }
  }

  async function handleDelete(id: string) {
    if (!currentCasa) return;
    const ok = await confirmDialog(
      'Eliminar cita',
      '¿Seguro que quieres eliminar esta cita?',
      { confirmText: 'Eliminar', destructive: true },
    );
    if (!ok) return;
    const error = await removeAppointment(id);
    if (error) Alert.alert('Error', error.message);
    else void cancelEntityKey('appointment', id);
  }

  function openKindsManager() {
    setEditingKindId(null);
    setKindName('');
    setKindIcon(DEFAULT_APPOINTMENT_ICON);
    setKindError(null);
    setKindsModalVisible(true);
  }

  function openEditKind(k: KindUI) {
    if (!k.id) return;
    setEditingKindId(k.id);
    setKindName(k.name);
    setKindIcon(k.icon);
    setKindError(null);
    setKindsModalVisible(true);
  }

  async function handleSaveKind() {
    const name = kindName.trim();
    if (!name) {
      setKindError('Escribe un nombre para el tipo.');
      return;
    }
    if (name.length > 40) {
      setKindError('El nombre no puede superar 40 caracteres.');
      return;
    }
    if (!currentCasa) return;
    setKindSaving(true);
    const error = editingKindId
      ? await updateAppointmentKind(editingKindId, { name, icon: kindIcon })
      : await addAppointmentKind({ casa_id: currentCasa.id, name, icon: kindIcon });
    setKindSaving(false);
    if (error) {
      setKindError(error.message);
      return;
    }
    setKindName('');
    setKindIcon(DEFAULT_APPOINTMENT_ICON);
    setKindError(null);
    setEditingKindId(null);
  }

  async function handleDeleteKind(k: KindUI) {
    if (!k.id) return;
    const ok = await confirmDialog(
      'Eliminar tipo',
      `Se eliminará el tipo «${k.name}». Las citas existentes conservarán su tipo.`,
      { confirmText: 'Eliminar', destructive: true },
    );
    if (!ok) return;
    const error = await removeAppointmentKind(k.id as string);
    if (error) Alert.alert('Error', error.message);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Citas</Text>
          <Text style={styles.subtitle}>Médico, escuela y más</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            style={styles.manageButton}
            accessibilityRole="button"
            accessibilityLabel="Gestionar tipos de cita"
            onPress={openKindsManager}>
            <Ionicons name="settings-outline" size={20} color={Palette.primary} />
          </Pressable>
          <Pressable
            style={styles.fab}
            accessibilityRole="button"
            accessibilityLabel="Nueva cita"
            onPress={openAdd}>
            <Ionicons name="add" size={28} color={Palette.onPrimary} />
          </Pressable>
        </View>
      </View>

      <FilterBar
        style={styles.filterBar}
        search={{ value: searchText, onChangeText: setSearchText, placeholder: 'Buscar citas' }}
        chips={{
          options: kindOptions,
          selected: selectedKind,
          onSelect: (value) => {
            if (typeof value === 'string') setSelectedKind(value);
          },
        }}
      />

      <ScrollView contentContainerStyle={styles.content}>
        {appointmentsError ? <ErrorBanner message={appointmentsError} /> : null}
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
                <View style={styles.cardActions}>
                  <Pressable
                    onPress={() => openEdit(a)}
                    hitSlop={14}
                    accessibilityRole="button"
                    accessibilityLabel={`Editar cita ${a.title}`}>
                    <Ionicons name="pencil-outline" size={20} color={Palette.textSecondary} />
                  </Pressable>
                  <Pressable
                    onPress={() => handleDelete(a.id)}
                    hitSlop={14}
                    accessibilityRole="button"
                    accessibilityLabel={`Eliminar cita ${a.title}`}>
                    <Ionicons name="trash-outline" size={20} color={Palette.danger} />
                  </Pressable>
                </View>
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
        accessibilityViewIsModal
        onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>
              {editingAppointmentId ? 'Editar cita' : 'Nueva cita'}
            </Text>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
              <TextField
                label="Título"
                value={title}
                onChangeText={setTitle}
                placeholder="P. ej. Revisión médica"
                error={errors.title}
              />

              <View style={styles.kindRow}>
                {kindRows.map((k) => (
                  <Pressable
                    key={k.id ?? k.name}
                    style={[styles.chip, kind === k.name && styles.chipSelected]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: kind === k.name }}
                    onPress={() => setKind(k.name)}>
                    <Ionicons
                      name={k.icon as keyof typeof Ionicons.glyphMap}
                      size={16}
                      color={kind === k.name ? Palette.onPrimary : Palette.textSecondary}
                    />
                    <Text style={[styles.chipText, kind === k.name && styles.chipTextSelected]}>
                      {k.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                onPress={openKindsManager}
                accessibilityRole="button"
                accessibilityLabel="Gestionar tipos"
                hitSlop={8}>
                <Text style={styles.manageLinkText}>Gestionar tipos</Text>
              </Pressable>

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
                <AppDatePicker
                  value={date}
                  mode="date"
                  icon="📅"
                  formatValue={(d) => d.toLocaleDateString('es-ES')}
                  accessibilityLabel={`Cambiar fecha: ${date.toLocaleDateString('es-ES')}`}
                  onChange={setDate}
                  style={styles.datePicker}
                />
                <AppDatePicker
                  value={time}
                  mode="time"
                  icon="🕐"
                  formatValue={(d) =>
                    d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
                  }
                  accessibilityLabel={`Cambiar hora: ${time.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`}
                  onChange={setTime}
                  style={styles.datePicker}
                />
              </View>
              {errors.date ? (
                <Text style={styles.error} accessibilityRole="alert">
                  {errors.date}
                </Text>
              ) : null}

              <Text style={styles.fieldLabel}>Recordar</Text>
              <View style={styles.kindRow}>
                {reminderChoices.map((value) => (
                  <Pressable
                    key={value}
                    style={[styles.chip, reminderChoice === value && styles.chipSelected]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: reminderChoice === value }}
                    onPress={() => setReminderChoice(value)}>
                    <Text
                      style={[styles.chipText, reminderChoice === value && styles.chipTextSelected]}>
                      {reminderChoiceLabels[value]}
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
                  title={editingAppointmentId ? 'Guardar cambios' : 'Guardar'}
                  onPress={handleSave}
                  loading={saving}
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={kindsModalVisible}
        animationType="slide"
        transparent
        accessibilityViewIsModal
        onRequestClose={() => setKindsModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Tipos de cita</Text>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
              {kindRows.map((k) => (
                <View
                  key={k.id ?? k.name}
                  style={styles.kindManageRow}
                  accessibilityLabel={`Tipo ${k.name}`}>
                  <Ionicons
                    name={k.icon as keyof typeof Ionicons.glyphMap}
                    size={18}
                    color={Palette.textStrong}
                  />
                  <Text style={styles.kindManageName}>{k.name}</Text>
                  {k.id ? (
                    <View style={styles.kindManageActions}>
                      <Pressable
                        onPress={() => openEditKind(k)}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel={`Editar tipo ${k.name}`}>
                        <Ionicons name="pencil-outline" size={20} color={Palette.textSecondary} />
                      </Pressable>
                      <Pressable
                        onPress={() => handleDeleteKind(k)}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel={`Eliminar tipo ${k.name}`}>
                        <Ionicons name="trash-outline" size={20} color={Palette.danger} />
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              ))}
              <IconPicker
                label="Icono"
                value={kindIcon}
                options={APPOINTMENT_ICON_OPTIONS}
                onChange={setKindIcon}
              />
              <TextField
                label={editingKindId ? 'Editar nombre' : 'Nuevo tipo'}
                value={kindName}
                onChangeText={setKindName}
                placeholder="P. ej. Reunión cole"
                error={kindError}
              />
              <View style={styles.modalActions}>
                <Button title="Cerrar" variant="secondary" onPress={() => setKindsModalVisible(false)} />
                <Button
                  title={editingKindId ? 'Guardar tipo' : 'Añadir tipo'}
                  onPress={handleSaveKind}
                  loading={kindSaving}
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  manageButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: Palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  pastTitle: { fontSize: 14, color: Palette.textSecondary },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.three },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  cardBody: { gap: Spacing.one, flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: Palette.text },
  cardMeta: { fontSize: 13, color: Palette.textSecondary },
  pastRow: { flexDirection: 'row', justifyContent: 'space-between' },
  modalOverlay: {
    flex: 1,
    backgroundColor: Palette.overlay,
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: Palette.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing.four,
    maxHeight: '92%',
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: Palette.text, marginBottom: Spacing.three },
  form: { gap: Spacing.three },
  kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  manageLinkText: { fontSize: 13, fontWeight: '700', color: Palette.primary, marginTop: Spacing.two },
  kindManageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
  },
  kindManageName: { flex: 1, fontSize: 15, color: Palette.textStrong },
  kindManageActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 44,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
  },
  chipSelected: { backgroundColor: Palette.primary, borderColor: Palette.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: Palette.textSecondary },
  chipTextSelected: { color: Palette.onPrimary },
  dateRow: { flexDirection: 'row', gap: Spacing.two },
  datePicker: { flex: 1 },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: Palette.textStrong },
  error: { color: Palette.danger, fontSize: 13 },
  modalActions: { flexDirection: 'row', gap: Spacing.three, marginTop: Spacing.two },
});
