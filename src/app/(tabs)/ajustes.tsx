import { useEffect, useMemo, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TextField } from '@/components/ui/text-field';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useCasa } from '@/context/casa-context';
import { useRealtimeCollection } from '@/hooks/use-realtime-collection';
import { useAppInstall } from '@/hooks/use-app-install';
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
  askEnableNotifications,
  canRequestPermissionAgain,
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
import { showNotice } from '@/lib/notice';
import type { Appointment, Casa, CasaMember, Contact } from '@/lib/types';
import {
  disableWebPush,
  enableWebPush,
  getActiveSubscription,
  isPushSupported,
  notificationPermission,
  sendTestPush,
  syncPushPreferences,
  WEB_PUSH_TIMEOUT_MS,
} from '@/lib/web-push';
import { withTimeout } from '@/lib/with-timeout';
import { validateCasaName, validateInviteCode } from '@/lib/validation';

/**
 * Un aviso debe poder leerse sin contexto: en web sale por `window.alert`, que
 * solo admite un texto y no lleva título. Cerrar otras pestañas es la salida
 * real cuando lo que se ha quedado esperando es la activación de un service
 * worker nuevo.
 */
const MSG_PUSH_TIMEOUT =
  'Los avisos no se han activado a tiempo. Cierra otras pestañas de MiCasa y vuelve a intentarlo.';

/**
 * Último recurso si la vista no trae pasos. Hoy `installView` siempre los da en
 * los estados en los que el botón puede fallar, así que es alcanzable solo si esa
 * función cambia: sin texto, quien pulse el botón y lo vea fallar se queda sin
 * ninguna instrucción.
 */
const SIN_PASOS_DE_INSTALACION = 'Abre el menú del navegador y elige la opción de instalar.';

/**
 * Tope del aviso de prueba. Es una petición a la Edge Function en frío, que
 * además tiene que contacting con el push service, así que se le da margen de
 * sobra: el objetivo es que un cuelgue no deje el botón muerto, no que el botón
 * falle pronto.
 */
const TEST_PUSH_TIMEOUT_MS = 30_000;

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
  // En web los avisos los manda el servidor, así que el estado real es si este
  // navegador tiene una suscripción activa, no la preferencia local.
  const isWeb = Platform.OS === 'web';
  const [pushSupported, setPushSupported] = useState(false);
  const [pushBlocked, setPushBlocked] = useState(false);
  const [webPushBusy, setWebPushBusy] = useState(false);
  // Secuencia de las lecturas del estado real del navegador: solo la última
  // respuesta escribe en el interruptor, para que una lectura lenta no pise la
  // acción que el usuario acaba de hacer.
  //
  // El número se incrementa **al empezar** la acción y no solo al terminar: una
  // lectura en vuelo del momento anterior puede resolver mientras la operación
  // sigue corriendo, y si el contador no se movió hasta el `finally`, esa
  // respuesta obsoleta entraba igual y el interruptor marcaba lo contrario de lo
  // que el usuario acaba de pedir. Con el incremento al inicio, cualquier lectura
  // anterior queda invalidada en el instante en que el usuario toca el
  // interruptor.
  const pushReadSeq = useRef(0);
  const [testPushBusy, setTestPushBusy] = useState(false);
  // La instalación de la web como app. En nativo no se enseña nada, y en web
  // solo aparece si hay algo que hacer: o se instala con un toque, o hay pasos
  // que dependen del navegador que tiene la persona.
  const appInstall = useAppInstall();

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

  useEffect(() => {
    if (!isWeb) return;
    let active = true;
    // La lectura de montaje entra en la misma secuencia que las del interruptor:
    // registrar el worker tarda 10 s, y si su respuesta llegara después de un
    // cambio del usuario marcaría lo contrario de lo que se acaba de hacer.
    const seq = ++pushReadSeq.current;
    (async () => {
      const supported = isPushSupported();
      if (!active) return;
      setPushSupported(supported);
      if (!supported) {
        setNotificationsEnabledState(false);
        return;
      }
      setPushBlocked(notificationPermission() === 'denied');
      // Con `try/catch` porque `getActiveSubscription` habla con el service
      // worker y ese puede rechazar (`InvalidStateError` en contextos no
      // seguros). Sin él, un rechazo aquí era una promesa sin capturar en el
      // navegador y el interruptor se quedaba sin verificar para siempre.
      try {
        const subscription = await getActiveSubscription();
        if (active && seq === pushReadSeq.current) setNotificationsEnabledState(Boolean(subscription));
      } catch {
        if (active && seq === pushReadSeq.current) setNotificationsEnabledState(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [isWeb]);

  async function handleToggleWebPush(next: boolean) {
    if (!user) return;
    setWebPushBusy(true);
    // Antes de esperar nada. Cualquier lectura del navegador que siguiera en
    // vuelo queda invalidada ya, no cuando esta operación termine dentro de
    // treinta segundos: si resolviera mientras tanto, escribiría el estado viejo
    // encima del nuevo.
    ++pushReadSeq.current;
    try {
      // web-push ya pone su propio tope por fases; este es el último recurso
      // para que ningún fallo por debajo pueda dejar el interruptor muerto.
      const result = await withTimeout(
        next ? enableWebPush(user) : disableWebPush(user),
        WEB_PUSH_TIMEOUT_MS,
        'la web no ha completado el cambio a tiempo',
      );

      if (result.status === 'enabled' || result.status === 'disabled') {
        setNotificationsEnabledState(next);
        setPushBlocked(false);
        return;
      }
      if (result.status === 'denied') {
        setPushBlocked(true);
        showNotice(
          'Permiso denegado',
          'El navegador no permite avisos en este sitio. Actívalo desde los ajustes del navegador (el icono del candado junto a la dirección) y vuelve a intentarlo.',
        );
        return;
      }
      if (result.status === 'unsupported') {
        // Solo llega si el navegador no tiene las tres APIs de push, y en ese
        // caso el interruptor está desactivado y no se puede pulsar, así que es
        // una rama de seguridad. El aviso de "añádela a la pantalla de inicio" no
        // va aquí: en iPhone el navegador SÍ dice que puede, y el problema es
        // que no envía en una pestaña. Eso lo explica la descripción del
        // interruptor, que mira la plataforma y el modo de visualización.
        showNotice('No disponible', 'Este navegador no admite avisos push.');
        return;
      }
      if (result.status === 'timeout') {
        showNotice('No ha terminado', MSG_PUSH_TIMEOUT);
        return;
      }
      // El verbo va según la dirección del cambio: decir "no se pudo activar" al
      // apagar deja al usuario creyendo que no ha pasado nada mientras le
      // siguen llegando avisos.
      showNotice('Error', `No se pudo ${next ? 'activar' : 'desactivar'} los avisos: ${result.reason}`);
    } catch {
      showNotice('No ha terminado', MSG_PUSH_TIMEOUT);
    } finally {
      // En `finally` y no al final de cada rama: una operación que se cuelga sin
      // rechazar deja el flag en `true` y el Switch inutilizable hasta que se
      // recargue la página, que es justo lo que pasaba en Android.
      setWebPushBusy(false);

      // Y el interruptor se relee del navegador en vez de quedarse con la
      // intención: un alta cortada por tiempo puede llegar tarde y, sin esto, el
      // Switch marcaría lo contrario de lo que hay.
      //
      // La relectura va con número de secuencia porque la consulta puede tardar
      // (registrar el worker son 10 s) y para entonces el usuario ya ha vuelto a
      // tocar el interruptor: si su respuesta llegara última, marcaría lo
      // contrario de lo que acaba de hacer. Solo aplica la última lectura.
      if (isWeb) {
        const seq = ++pushReadSeq.current;
        void getActiveSubscription()
          .then((subscription) => {
            if (seq === pushReadSeq.current) setNotificationsEnabledState(Boolean(subscription));
          })
          .catch(() => undefined);
      }
    }
  }

  /**
   * Instala la web como app, si el navegador lo permite con un toque.
   *
   * El botón solo aparece cuando el navegador ha lanzado el evento, así que
   * aquí casi siempre va a funcionar. Pero si la persona lo rechaza, o si el
   * evento ya se gastó, se le dice cómo se hace a mano en lugar de dejar el
   * botón ahí para que lo pulse otra vez y no pase nada.
   */
  async function handleInstallApp() {
    const installed = await appInstall.install();
    if (installed) {
      showNotice('App instalada', 'Ya tienes MiCasa con su propio icono en este dispositivo.');
      return;
    }
    // El primer paso ya está escrito como una instrucción entera ("Abre el menú
    // Compartir, el cuadrado con la flecha hacia arriba."), así que se enseña tal
    // cual en vez de recortarlo. Si el estado era `instalable` los pasos no se
    // estaban pintando, pero siguen siendo la salida cuando el botón falla.
    // Con `?.` porque la única regla de esta pantalla es que no se rompe: esta
    // tarjeta es opcional y no puede ser el motivo de que Ajustes no abra.
    const primerPaso = appInstall.view.manualSteps?.[0];
    showNotice('Se instala desde el navegador', primerPaso ?? SIN_PASOS_DE_INSTALACION);
  }

  /**
   * Pide un aviso de prueba a la Edge Function. Es la forma rápida de comprobar
   * que la suscripción está viva y que el service worker pinta la notificación,
   * sin esperar a un recordatorio real.
   */
  async function handleTestPush() {
    setTestPushBusy(true);
    try {
      // Con `finally` y con tope por la misma razón que el interruptor: un
      // `fetch` que no responde (portal cautivo, red móvil parada, función en
      // frío) dejaba `testPushBusy` en `true` y el botón inutilizable hasta
      // recargar, que era justo el fallo que este bloque viene a cerrar.
      const result = await withTimeout(sendTestPush(), TEST_PUSH_TIMEOUT_MS, MSG_PUSH_TIMEOUT);

      if (result.ok) {
        showNotice('Aviso enviado', `Enviado a ${result.delivered} navegador(es).`);
        return;
      }
      if (result.error === 'demasiado rapido') {
        const minutes = Math.max(1, Math.ceil((result.retryInSeconds ?? 60) / 60));
        showNotice('Espera un momento', `Puedes pedir otro aviso en ${minutes} minuto(s).`);
        return;
      }
      showNotice('No se pudo enviar', result.error);
    } catch {
      showNotice('No se pudo enviar', MSG_PUSH_TIMEOUT);
    } finally {
      setTestPushBusy(false);
    }
  }

  /**
   * Al cerrar sesión se da de baja la suscripción de este navegador. Si no, los
   * avisos de la cuenta anterior seguirían llegando a un equipo compartido, y el
   * endpoint (que es una credencial) quedaría vivo para siempre.
   */
  async function handleSignOut() {
    if (isWeb && user) {
      try {
        const result = await disableWebPush(user);
        // El registro sobrevive tanto a un fallo como a un cuelgue con tope, y en
        // los dos casos este navegador seguiría recibiendo los avisos de la
        // cuenta que se acaba de cerrar en un equipo compartido. Se avisa en
        // consola porque la sesión ya se está cerrando.
        if (result.status === 'failed' || result.status === 'timeout') {
          console.warn('No se pudo dar de baja la suscripción push', result.reason);
        }
      } catch {
        // Si falla la limpieza, se cierra sesión igualmente: no se bloquea el
        // cierre por un problema de avisos.
      }
    }
    await signOut();
  }

  async function handleToggleNotifications(next: boolean) {
    if (isWeb) {
      await handleToggleWebPush(next);
      return;
    }
    try {
      if (next) {
        const granted = await requestPermissions();
        if (!granted) {
          const canAsk = await canRequestPermissionAgain();
          // Este es el único `Alert.alert` que se queda: necesita botones, y
          // `window.alert` no los tiene. Solo se ejecuta en nativo.
          Alert.alert(
            'Permiso denegado',
            'Activa las notificaciones desde los ajustes del sistema para recibir avisos.',
            canAsk
              ? [{ text: 'OK' }]
              : [
                  { text: 'Cancelar', style: 'cancel' },
                  {
                    text: 'Abrir ajustes',
                    onPress: () => void Linking.openSettings().catch(() => undefined),
                  },
                ],
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
      showNotice('Error', 'No se pudo cambiar el estado de las notificaciones.');
    }
  }

  async function handleBirthdayChoice(choice: ReminderChoice) {
    try {
      if (choice !== 'none' && !notificationsEnabled && !isWeb) {
        const result = await askEnableNotifications(
          'Activa las notificaciones para recibir avisos de cumpleaños.',
        );
        if (result !== 'enabled') return;
        setNotificationsEnabledState(true);
      }
      setBirthdayChoiceState(choice);
      await setBirthdayChoice(choice);
      if (isWeb) {
        // En web quien decide cuándo avisar es el servidor, no el dispositivo.
        // Solo la preferencia de cumpleaños. `enabled` es el interruptor maestro
        // y solo lo escriben enableWebPush/disableWebPush: si el selector lo
        // tocara, elegir "sin aviso" apagaría también las citas, y volver a
        // tocarlo reencendería un interruptor que el usuario había apagado.
        await syncPushPreferences(user, { birthdayChoice: choice });
      } else {
        await scheduleBirthdays(contacts, choice);
      }
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
        <Button title="Cerrar sesión" variant="danger" onPress={() => void handleSignOut()} />
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
            <Text style={styles.cardMeta}>
              {isWeb
                ? !pushSupported
                  ? 'Este navegador no admite avisos push'
                  : pushBlocked
                    ? 'Permiso denegado: actívalo desde los ajustes del navegador'
                    : 'Avisos de citas y cumpleaños, aunque cierres la app'
                : 'Avisos de citas y cumpleaños'}
            </Text>
            {/* En iPhone el navegador dice que puede enviar pero no envia en una
                pestaña normal. El aviso va DESPUÉS de la descripción y no en vez
                de ella: quien no sabe qué hace el interruptor lo pulses o no, y
                sin esa frase no entiende por qué se le pide instalar. */}
            {isWeb && appInstall.pushNotice ? (
              <Text style={styles.cardMeta}>{appInstall.pushNotice.body}</Text>
            ) : null}
          </View>
          <Switch
            value={notificationsEnabled}
            onValueChange={handleToggleNotifications}
            disabled={prefsLoading || (isWeb && (!pushSupported || webPushBusy))}
            trackColor={{ false: Palette.border, true: Palette.primary }}
            thumbColor={Palette.onPrimary}
            accessibilityLabel="Activar notificaciones"
          />
        </View>
        {isWeb && pushSupported ? (
          <View style={styles.settingRow}>
            <View style={styles.settingText}>
              <Text style={styles.settingLabel}>Aviso de prueba</Text>
              <Text style={styles.cardMeta}>
                Comprueba que los avisos llegan con el móvil bloqueado
              </Text>
            </View>
            <Button
              title={testPushBusy ? 'Enviando…' : 'Enviar'}
              variant="secondary"
              disabled={testPushBusy || webPushBusy}
              onPress={() => void handleTestPush()}
            />
          </View>
        ) : null}
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

      {appInstall.view.visible ? (
        <Card>
          <Text style={styles.sectionTitle}>{appInstall.view.title}</Text>
          <Text style={styles.cardMeta}>{appInstall.view.body}</Text>
          {appInstall.view.steps.length > 0 ? (
            <View style={styles.stepList}>
              {appInstall.view.steps.map((paso, index) => (
                <View key={paso} style={styles.stepRow}>
                  <View style={[styles.stepNumber, index === 0 && styles.stepNumberFirst]}>
                    <Text
                      style={[
                        styles.stepNumberText,
                        index === 0 && styles.stepNumberTextFirst,
                      ]}>
                      {index + 1}
                    </Text>
                  </View>
                  <Text style={[styles.stepText, index === 0 && styles.stepTextFirst]}>
                    {paso}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          {appInstall.view.action ? (
            <Button
              title={appInstall.view.action}
              onPress={() => void handleInstallApp()}
            />
          ) : null}
        </Card>
      ) : null}

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
  // Los pasos de instalación van numerados, y el primero destacado: es el que
  // dice dónde tocar, y es lo único que lee quien solo quiere el dato rápido.
  stepList: { gap: Spacing.two, marginTop: Spacing.two },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.surfaceAlt,
  },
  stepNumberFirst: { backgroundColor: Palette.primarySoft },
  stepNumberText: { fontSize: 12, fontWeight: '700', color: Palette.textSecondary },
  stepNumberTextFirst: { color: Palette.accent },
  stepText: { flex: 1, fontSize: 14, color: Palette.textSecondary, lineHeight: 20 },
  stepTextFirst: { color: Palette.textStrong, fontWeight: '600' },
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
