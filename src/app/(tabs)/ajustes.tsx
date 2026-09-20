import { useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TextField } from '@/components/ui/text-field';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useCasa } from '@/context/casa-context';
import { useRealtimeCollection } from '@/hooks/use-realtime-collection';
import {
  fetchAppointments,
  fetchContacts,
  removeCasaMember,
  setCasaMemberRole,
} from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import { formatInviteCode, initials } from '@/lib/format';
import {
  areNotificationsEnabled,
  getBirthdayChoice,
  requestPermissions,
  scheduleBirthdays,
  setBirthdayChoice,
  setNotificationsEnabled,
  syncAll,
} from '@/lib/notifications';
import {
  reminderChoiceLabels,
  reminderChoices,
  type ReminderChoice,
} from '@/lib/notification-schedule';
import type { Appointment, Casa, CasaMember, Contact } from '@/lib/types';
import { validateCasaName, validateInviteCode } from '@/lib/validation';

export default function AjustesScreen() {
  const { user, signOut } = useAuth();
  const {
    casas,
    currentCasa,
    members,
    profiles,
    setCurrentCasa,
    createCasa,
    joinCasa,
    renameCasa,
    deleteCasa,
    refreshMembers,
  } = useCasa();

  const isOwner = useMemo(
    () =>
      Boolean(
        user &&
          currentCasa &&
          members.some((m) => m.user_id === user.id && m.role === 'owner'),
      ),
    [user, currentCasa, members],
  );

  const [createModal, setCreateModal] = useState(false);
  const [joinModal, setJoinModal] = useState(false);
  const [editingCasa, setEditingCasa] = useState<Casa | null>(null);
  const [casaName, setCasaName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [notificationsEnabled, setNotificationsEnabledState] = useState(false);
  const [birthdayChoice, setBirthdayChoiceState] = useState<ReminderChoice>('none');
  const [prefsLoading, setPrefsLoading] = useState(true);

  const { data: appointments } = useRealtimeCollection<Appointment>(
    () => (currentCasa ? fetchAppointments(currentCasa.id) : Promise.resolve([])),
    'appointments',
    currentCasa?.id ?? null,
  );
  const { data: contacts } = useRealtimeCollection<Contact>(
    () => (currentCasa ? fetchContacts(currentCasa.id) : Promise.resolve([])),
    'contacts',
    currentCasa?.id ?? null,
  );

  useEffect(() => {
    let active = true;
    (async () => {
      const [enabled, choice] = await Promise.all([
        areNotificationsEnabled(),
        getBirthdayChoice(),
      ]);
      if (!active) return;
      setNotificationsEnabledState(enabled);
      setBirthdayChoiceState(choice);
      setPrefsLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  async function handleToggleNotifications(next: boolean) {
    try {
      if (next) {
        const granted = await requestPermissions();
        if (!granted) {
          Alert.alert(
            'Permiso denegado',
            'Activa las notificaciones desde los ajustes del sistema.',
          );
          return;
        }
        await setNotificationsEnabled(true);
        setNotificationsEnabledState(true);
        await syncAll(appointments, contacts, birthdayChoice);
      } else {
        await setNotificationsEnabled(false);
        setNotificationsEnabledState(false);
      }
    } catch {
      // el sync por realtime reintentará
    }
  }

  async function handleBirthdayChoice(choice: ReminderChoice) {
    try {
      setBirthdayChoiceState(choice);
      await setBirthdayChoice(choice);
      await scheduleBirthdays(contacts, choice);
    } catch {
      // el sync por realtime reintentará
    }
  }

  function openEditCasa(casa: Casa) {
    setEditingCasa(casa);
    setCasaName(casa.name);
    setError(null);
    setCreateModal(true);
  }

  async function handleSaveCasa() {
    const check = validateCasaName(casaName);
    if (!check.valid) {
      setError(check.message);
      return;
    }
    setLoading(true);
    const err = editingCasa
      ? await renameCasa(editingCasa.id, casaName)
      : await createCasa(casaName);
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    setCasaName('');
    setError(null);
    setEditingCasa(null);
    setCreateModal(false);
  }

  async function handleDeleteCasa(casa: Casa) {
    const ok = await confirmDialog(
      'Eliminar casa',
      `Se borrarán «${casa.name}» y todos sus datos. Esta acción no se puede deshacer.`,
      { confirmText: 'Eliminar', destructive: true },
    );
    if (!ok) return;
    const err = await deleteCasa(casa.id);
    if (err) Alert.alert('Error', err.message);
  }

  function openAddCasa() {
    setEditingCasa(null);
    setCasaName('');
    setError(null);
    setCreateModal(true);
  }

  async function handleJoin() {
    const check = validateInviteCode(inviteCode);
    if (!check.valid) {
      setError(check.message);
      return;
    }
    setLoading(true);
    const err = await joinCasa(inviteCode);
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    setInviteCode('');
    setError(null);
    setJoinModal(false);
  }

  function handleToggleRole(member: CasaMember) {
    if (!currentCasa) return;
    const next = member.role === 'admin' ? 'member' : 'admin';
    const name = profiles[member.user_id]?.display_name ?? 'Este miembro';
    Alert.alert(
      next === 'admin' ? 'Hacer administrador' : 'Quitar administrador',
      `${name} pasará a ${next === 'admin' ? 'administrador' : 'miembro'}.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Confirmar',
          onPress: async () => {
            const err = await setCasaMemberRole(currentCasa.id, member.user_id, next);
            if (err) Alert.alert('Error', err.message);
            else await refreshMembers();
          },
        },
      ],
    );
  }

  async function handleRemoveMember(member: CasaMember) {
    if (!currentCasa) return;
    const name = profiles[member.user_id]?.display_name ?? 'Este miembro';
    const ok = await confirmDialog('Eliminar miembro', `¿Quitar a ${name} de la casa?`, {
      confirmText: 'Eliminar',
      destructive: true,
    });
    if (!ok) return;
    const err = await removeCasaMember(currentCasa.id, member.user_id);
    if (err) Alert.alert('Error', err.message);
    else await refreshMembers();
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card>
        <Text style={styles.sectionTitle}>Perfil</Text>
        <View style={styles.profileRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {initials(profiles[user?.id ?? '']?.display_name ?? user?.email ?? '?')}
            </Text>
          </View>
          <View>
            <Text style={styles.profileName}>
              {profiles[user?.id ?? '']?.display_name ?? 'Usuario'}
            </Text>
            <Text style={styles.cardMeta}>{user?.email}</Text>
          </View>
        </View>
        <Button title="Cerrar sesión" variant="danger" onPress={() => signOut()} />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Tu casa</Text>
        <Text style={styles.casaName}>{currentCasa?.name ?? 'Sin casa'}</Text>
        <View style={styles.inviteRow}>
          <Text style={styles.cardMeta}>Código de invitación</Text>
          <Text style={styles.inviteCode}>
            {formatInviteCode(currentCasa?.invite_code ?? '--------')}
          </Text>
        </View>
        <Text style={styles.cardMeta}>Comparte el código para que tu pareja o familia entre.</Text>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Recordatorios</Text>
        <View style={styles.settingRow}>
          <View style={styles.settingText}>
            <Text style={styles.settingLabel}>Notificaciones</Text>
            <Text style={styles.cardMeta}>Avisos de citas y cumpleaños</Text>
          </View>
          <Switch
            value={notificationsEnabled}
            onValueChange={handleToggleNotifications}
            disabled={prefsLoading}
            trackColor={{ false: Palette.border, true: Palette.primary }}
            thumbColor={Palette.onPrimary}
            accessibilityLabel="Activar notificaciones"
          />
        </View>
        <Text style={styles.settingLabel}>Cumpleaños: avisar</Text>
        <View style={styles.chipRow}>
          {reminderChoices.map((value) => (
            <Pressable
              key={value}
              style={[styles.chip, birthdayChoice === value && styles.chipSelected]}
              accessibilityRole="radio"
              accessibilityState={{ checked: birthdayChoice === value }}
              onPress={() => handleBirthdayChoice(value)}>
              <Text style={[styles.chipText, birthdayChoice === value && styles.chipTextSelected]}>
                {reminderChoiceLabels[value]}
              </Text>
            </Pressable>
          ))}
        </View>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Miembros ({members.length})</Text>
        {members.map((m) => (
          <View key={m.user_id} style={styles.memberRow}>
            <View style={styles.memberAvatar}>
              <Text style={styles.memberAvatarText}>
                {initials(profiles[m.user_id]?.display_name ?? '?')}
              </Text>
            </View>
            <Text style={styles.memberName}>
              {profiles[m.user_id]?.display_name ?? 'Miembro'}
            </Text>
            <Text style={styles.cardMeta}>
              {m.role === 'owner' ? 'Administrador' : m.role === 'admin' ? 'Admin' : 'Miembro'}
            </Text>
            {isOwner && m.user_id !== user?.id && m.role !== 'owner' ? (
              <View style={styles.memberActions}>
                <Pressable
                  onPress={() => handleToggleRole(m)}
                  hitSlop={10}
                  accessibilityLabel={
                    m.role === 'admin' ? 'Quitar administrador' : 'Hacer administrador'
                  }>
                  <Ionicons
                    name={m.role === 'admin' ? 'shield-outline' : 'shield-checkmark-outline'}
                    size={20}
                    color={Palette.primary}
                  />
                </Pressable>
                <Pressable
                  onPress={() => handleRemoveMember(m)}
                  hitSlop={10}
                  accessibilityLabel={`Eliminar a ${profiles[m.user_id]?.display_name ?? 'miembro'}`}>
                  <Ionicons name="trash-outline" size={20} color={Palette.danger} />
                </Pressable>
              </View>
            ) : null}
          </View>
        ))}
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Casas</Text>
        {casas.map((casa) => (
          <Pressable
            key={casa.id}
            style={styles.casaRow}
            accessibilityRole="radio"
            accessibilityState={{ checked: casa.id === currentCasa?.id }}
            onPress={() => {
              setCurrentCasa(casa);
              Alert.alert('Casa seleccionada', `Ahora estás gestionando «${casa.name}».`);
            }}>
            <Ionicons name="home-outline" size={20} color={casa.id === currentCasa?.id ? Palette.primary : Palette.textMuted} />
            <Text
              style={[
                styles.casaRowName,
                casa.id === currentCasa?.id && styles.casaRowActive,
              ]}>
              {casa.name}
            </Text>
            {casa.id === currentCasa?.id ? (
              <Ionicons name="checkmark-circle" size={20} color={Palette.success} />
            ) : null}
            {isOwner ? (
              <View style={styles.casaRowActions}>
                <Pressable
                  onPress={() => openEditCasa(casa)}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={`Editar casa ${casa.name}`}>
                  <Ionicons name="pencil-outline" size={20} color={Palette.textSecondary} />
                </Pressable>
                <Pressable
                  onPress={() => handleDeleteCasa(casa)}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={`Eliminar casa ${casa.name}`}>
                  <Ionicons name="trash-outline" size={20} color={Palette.danger} />
                </Pressable>
              </View>
            ) : null}
          </Pressable>
        ))}
        <View style={styles.casaActions}>
          <Button title="Nueva casa" onPress={openAddCasa} />
          <Button title="Unirme por código" variant="secondary" onPress={() => setJoinModal(true)} />
        </View>
      </Card>

      <Modal
        visible={createModal}
        animationType="slide"
        transparent
        accessibilityViewIsModal
        onRequestClose={() => setCreateModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>
              {editingCasa ? 'Editar casa' : 'Crear nueva casa'}
            </Text>
            <TextField
              label="Nombre de la casa"
              value={casaName}
              onChangeText={setCasaName}
              placeholder="P. ej. Casa de la playa"
              error={error}
            />
            <View style={styles.modalActions}>
              <Button title="Cancelar" variant="secondary" onPress={() => setCreateModal(false)} />
              <Button
                title={editingCasa ? 'Guardar cambios' : 'Crear'}
                onPress={handleSaveCasa}
                loading={loading}
              />
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={joinModal}
        animationType="slide"
        transparent
        accessibilityViewIsModal
        onRequestClose={() => setJoinModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Unirse a una casa</Text>
            <TextField
              label="Código de invitación"
              value={inviteCode}
              onChangeText={setInviteCode}
              autoCapitalize="characters"
              placeholder="ABCDEF0123456789"
              error={error}
            />
            <View style={styles.modalActions}>
              <Button title="Cancelar" variant="secondary" onPress={() => setJoinModal(false)} />
              <Button title="Unirme" onPress={handleJoin} loading={loading} />
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.background },
  content: { padding: Spacing.four, gap: Spacing.four, paddingBottom: Spacing.six },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: Palette.text },
  cardMeta: { fontSize: 13, color: Palette.textSecondary },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: Radius.pill,
    backgroundColor: Palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: Palette.onPrimary, fontSize: 18, fontWeight: '700' },
  profileName: { fontSize: 17, fontWeight: '700', color: Palette.text },
  casaName: { fontSize: 22, fontWeight: '800', color: Palette.text },
  inviteRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  inviteCode: {
    fontFamily: 'monospace',
    fontSize: 18,
    fontWeight: '700',
    color: Palette.primary,
    letterSpacing: 2,
  },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  memberAvatar: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    backgroundColor: Palette.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarText: { fontSize: 14, fontWeight: '700', color: Palette.primary },
  memberName: { flex: 1, fontSize: 15, fontWeight: '600', color: Palette.textStrong },
  memberActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  casaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 44,
    paddingVertical: Spacing.two,
  },
  casaRowName: { flex: 1, fontSize: 15, color: Palette.textStrong },
  casaRowActive: { fontWeight: '700', color: Palette.primary },
  casaRowActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  casaActions: { gap: Spacing.two, marginTop: Spacing.two },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    marginBottom: Spacing.three,
  },
  settingText: { flex: 1, gap: 2 },
  settingLabel: { fontSize: 15, fontWeight: '600', color: Palette.textStrong },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.two },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 44,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelected: { backgroundColor: Palette.primary, borderColor: Palette.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: Palette.textSecondary },
  chipTextSelected: { color: Palette.onPrimary },
  modalOverlay: { flex: 1, backgroundColor: Palette.overlay, justifyContent: 'flex-end' },
  modal: {
    backgroundColor: Palette.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: Palette.text },
  modalActions: { flexDirection: 'row', gap: Spacing.three, marginTop: Spacing.two },
});
