import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TextField } from '@/components/ui/text-field';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useCasa } from '@/context/casa-context';
import { formatInviteCode, initials } from '@/lib/format';
import { validateCasaName, validateInviteCode } from '@/lib/validation';

export default function AjustesScreen() {
  const { user, signOut } = useAuth();
  const { casas, currentCasa, members, profiles, setCurrentCasa, createCasa, joinCasa } = useCasa();

  const [createModal, setCreateModal] = useState(false);
  const [joinModal, setJoinModal] = useState(false);
  const [casaName, setCasaName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    const check = validateCasaName(casaName);
    if (!check.valid) {
      setError(check.message);
      return;
    }
    setLoading(true);
    const err = await createCasa(casaName);
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    setCasaName('');
    setError(null);
    setCreateModal(false);
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
          </Pressable>
        ))}
        <View style={styles.casaActions}>
          <Button title="Nueva casa" onPress={() => setCreateModal(true)} />
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
            <Text style={styles.modalTitle}>Crear nueva casa</Text>
            <TextField
              label="Nombre de la casa"
              value={casaName}
              onChangeText={setCasaName}
              placeholder="P. ej. Casa de la playa"
              error={error}
            />
            <View style={styles.modalActions}>
              <Button title="Cancelar" variant="secondary" onPress={() => setCreateModal(false)} />
              <Button title="Crear" onPress={handleCreate} loading={loading} />
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
  casaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 44,
    paddingVertical: Spacing.two,
  },
  casaRowName: { flex: 1, fontSize: 15, color: Palette.textStrong },
  casaRowActive: { fontWeight: '700', color: Palette.primary },
  casaActions: { gap: Spacing.two, marginTop: Spacing.two },
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
