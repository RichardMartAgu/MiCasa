import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useCasa } from '@/context/casa-context';
import { useRealtimeCollection } from '@/hooks/use-realtime-collection';
import { fetchAppointments, fetchContacts, fetchExpenses, fetchShoppingLists } from '@/lib/api';
import { birthdayLabel, upcomingBirthdays } from '@/lib/birthdays';
import { monthKey } from '@/lib/date';
import { totalExpenses } from '@/lib/finance';
import { formatCurrency, initials } from '@/lib/format';
import type { Appointment, Contact, Expense, ShoppingList } from '@/lib/types';

export default function HomeScreen() {
  const { user } = useAuth();
  const { currentCasa, members, profiles } = useCasa();

  const { data: appointments, error: appointmentsError } = useRealtimeCollection<Appointment>(
    () => (currentCasa ? fetchAppointments(currentCasa.id) : Promise.resolve([])),
    'appointments',
    currentCasa?.id ?? null,
  );
  const { data: expenses, error: expensesError } = useRealtimeCollection<Expense>(
    () => (currentCasa ? fetchExpenses(currentCasa.id) : Promise.resolve([])),
    'expenses',
    currentCasa?.id ?? null,
  );
  const { data: lists, error: listsError } = useRealtimeCollection<ShoppingList>(
    () => (currentCasa ? fetchShoppingLists(currentCasa.id) : Promise.resolve([])),
    'shopping_lists',
    currentCasa?.id ?? null,
  );
  const { data: contacts, error: contactsError } = useRealtimeCollection<Contact>(
    () => (currentCasa ? fetchContacts(currentCasa.id) : Promise.resolve([])),
    'contacts',
    currentCasa?.id ?? null,
  );

  const loadError = appointmentsError ?? expensesError ?? listsError ?? contactsError;

  const upcoming = useMemo(() => {
    const now = new Date();
    return upcomingBirthdays(contacts, now, 30);
  }, [contacts]);

  const nextAppointments = useMemo(() => {
    const now = new Date();
    return appointments
      .filter((a) => new Date(a.starts_at) >= now)
      .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
      .slice(0, 3);
  }, [appointments]);

  const monthTotal = useMemo(() => {
    const key = monthKey(new Date());
    return totalExpenses(expenses.filter((e) => monthKey(new Date(e.spent_at)) === key));
  }, [expenses]);

  const pendingLists = useMemo(() => lists.filter((l) => !l.done).length, [lists]);

  const myProfile = user ? profiles[user.id] : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.casaName}>{currentCasa?.name ?? 'MiCasa'}</Text>
            <Text style={styles.greeting}>
              Hola, {myProfile?.display_name ?? 'casa'} 👋
            </Text>
          </View>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials(myProfile?.display_name ?? user?.email ?? '?')}</Text>
          </View>
        </View>
        <Text style={styles.memberCount}>
          {members.length} {members.length === 1 ? 'miembro' : 'miembros'} · código de
          invitación: <Text style={styles.code}>{currentCasa?.invite_code}</Text>
        </Text>
      </View>

      {loadError ? <ErrorBanner message={loadError} /> : null}

      <View style={styles.statsRow}>
        <Card style={styles.statCard}>
          <Text style={styles.statValue}>{formatCurrency(monthTotal)}</Text>
          <Text style={styles.statLabel}>Gastos este mes</Text>
        </Card>
        <Card style={styles.statCard}>
          <Text style={styles.statValue}>{pendingLists}</Text>
          <Text style={styles.statLabel}>Listas pendientes</Text>
        </Card>
      </View>

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Próximas citas</Text>
        {nextAppointments.length === 0 ? (
          <Text style={styles.empty}>No hay citas próximas.</Text>
        ) : (
          nextAppointments.map((a) => (
            <View key={a.id} style={styles.row}>
              <Text style={styles.rowTitle}>{a.title}</Text>
              <Text style={styles.rowMeta}>
                {new Date(a.starts_at).toLocaleDateString('es-ES', {
                  day: 'numeric',
                  month: 'short',
                })}{' '}
                · {new Date(a.starts_at).toLocaleTimeString('es-ES', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            </View>
          ))
        )}
      </Card>

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Próximos cumpleaños 🎂</Text>
        {upcoming.length === 0 ? (
          <Text style={styles.empty}>Añade contactos para ver sus cumpleaños.</Text>
        ) : (
          upcoming.slice(0, 4).map(({ contact, daysUntil }) => (
            <View key={contact.id} style={styles.row}>
              <Text style={styles.rowTitle}>
                {contact.name} <Text style={styles.rowMeta}>(cumple años)</Text>
              </Text>
              <Text style={[styles.rowMeta, daysUntil <= 7 && styles.soon]}>
                {birthdayLabel(daysUntil)}
              </Text>
            </View>
          ))
        )}
      </Card>

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Miembros de la casa</Text>
        {members.map((m) => (
          <View key={m.user_id} style={styles.row}>
            <Text style={styles.rowTitle}>{profiles[m.user_id]?.display_name ?? '—'}</Text>
            <Text style={styles.rowMeta}>
              {m.role === 'owner' ? 'Administrador' : 'Miembro'}
            </Text>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.background },
  content: { padding: Spacing.four, gap: Spacing.four, paddingBottom: Spacing.six },
  header: { gap: Spacing.two },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  casaName: { fontSize: 28, fontWeight: '800', color: Palette.text },
  greeting: { fontSize: 16, color: Palette.textSecondary },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: Radius.pill,
    backgroundColor: Palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: Palette.onPrimary, fontSize: 18, fontWeight: '700' },
  memberCount: { fontSize: 13, color: Palette.textSecondary },
  code: { fontFamily: 'monospace', fontWeight: '700', color: Palette.primary },
  statsRow: { flexDirection: 'row', gap: Spacing.three },
  statCard: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: Palette.primarySoft,
    borderColor: 'transparent',
  },
  statValue: { fontSize: 24, fontWeight: '800', color: Palette.primary },
  statLabel: { fontSize: 13, color: Palette.textSecondary, textAlign: 'center' },
  section: { gap: Spacing.three },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: Palette.text },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '600', color: Palette.textStrong, flexShrink: 1 },
  rowMeta: { fontSize: 13, color: Palette.textSecondary },
  soon: { color: Palette.danger, fontWeight: '700' },
  empty: { fontSize: 14, color: Palette.textMuted },
});
