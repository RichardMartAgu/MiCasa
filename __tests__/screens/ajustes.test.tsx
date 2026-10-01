import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, Platform } from 'react-native';

import AjustesScreen from '@/app/(tabs)/ajustes';
import type { PromptDecision } from '@/hooks/use-app-install';
import { WEB_PUSH_TIMEOUT_MS } from '@/lib/web-push-timeouts';
import type { Casa, CasaMember, Profile } from '@/lib/types';

jest.mock('@react-native-community/datetimepicker', () => {
  const { View } = require('react-native');
  return function MockPicker() {
    return <View testID="date-picker" />;
  };
});

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => <Text>{name}</Text>,
  };
});

const mockUseAuth = jest.fn();
jest.mock('@/context/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockUseCasa = jest.fn();
jest.mock('@/context/casa-context', () => ({
  useCasa: () => mockUseCasa(),
}));

const mockUseRealtimeCollection = jest.fn();
jest.mock('@/hooks/use-realtime-collection', () => ({
  useRealtimeCollection: (...args: unknown[]) => mockUseRealtimeCollection(...args),
}));

// La instalación se aisla con su hook entero: lo que se prueba aquí es cómo la
// tarjeta se pinta y qué hace el botón, no el evento del navegador, que ya
// tiene sus tests en `__tests__/hooks/use-app-install.test.ts`.
const mockUseAppInstall = jest.fn();
jest.mock('@/hooks/use-app-install', () => ({
  useAppInstall: () => mockUseAppInstall(),
}));

const mockRemoveCasaMember = jest.fn();
const mockSetCasaMemberRole = jest.fn();
jest.mock('@/lib/api', () => ({
  fetchAppointments: jest.fn(),
  fetchContacts: jest.fn(),
  removeCasaMember: (...args: unknown[]) => mockRemoveCasaMember(...args),
  setCasaMemberRole: (...args: unknown[]) => mockSetCasaMemberRole(...args),
}));

const mockAreNotificationsEnabled = jest.fn();
const mockAskEnableNotifications = jest.fn();
const mockCanRequestPermissionAgain = jest.fn();
const mockGetBirthdayChoice = jest.fn();
const mockRequestPermissions = jest.fn();
const mockScheduleBirthdays = jest.fn();
const mockSetBirthdayChoice = jest.fn();
const mockSetNotificationsEnabled = jest.fn();
const mockSyncAll = jest.fn();
const mockIsPushSupported = jest.fn(() => false);
const mockGetActiveSubscription = jest.fn(async () => null);
// `string | null` y no solo `string` porque la lectura devuelve `null` cuando no
// puede saber qué hay guardado, que es un estado que la pantalla trata de forma
// distinta a "sin aviso". Tiparlo solo como `string` impedía escribir el caso que
// más importa, el de la lectura que no sabe.
const mockGetStoredBirthdayChoice = jest.fn<Promise<string | null>, [unknown]>(async () => null);
const mockNotificationPermission = jest.fn(() => 'default' as const);
// Con la firma de los dos argumentos que recibe, y no sin ellos: si el mock
// aceptara cero, reenviar los argumentos desde la fábrica se quejaría al
// compilar y la firma real se perdería.
const mockSyncPushPreferences = jest.fn<Promise<void>, [unknown, unknown]>(async () => undefined);
const mockEnableWebPush = jest.fn();
const mockDisableWebPush = jest.fn();
const mockSendTestPush: jest.Mock<Promise<{ ok: boolean; error?: string; retryInSeconds?: number; delivered?: number }>> =
  jest.fn(async () => ({ ok: true, delivered: 1 }));

/** Copia del mensaje de `ajustes.tsx`, que en web sale sin título por `window.alert`. */
const MSG_PUSH_TIMEOUT =
  'Los avisos no se han activado a tiempo. Cierra otras pestañas de MiCasa y vuelve a intentarlo.';

/** `window.alert`, que es la única vía por la que se puede ver un aviso en web. */
function stubWebAlert(): jest.Mock {
  const spy = jest.fn();
  (globalThis as { alert?: (text: string) => void }).alert = spy;
  return spy;
}

jest.mock('@/lib/web-push', () => {
  // El tope se lee de `web-push-timeouts`, no de una constante declarada aquí ni
  // de `web-push` con `requireActual` (que arrastra el cliente de Supabase y
  // revienta sin variables de entorno). `jest.mock` se eleva por encima de los
  // imports, así que una `const` de este fichero todavía no existiría cuando la
  // fábrica se invoca: el mock recibía `undefined`, `withTimeout(..., undefined)`
  // cortaba al instante y el test del tope pasaba sin comprobar nada.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const topes = jest.requireActual('@/lib/web-push-timeouts') as { WEB_PUSH_TIMEOUT_MS: number };
  return {
  isPushSupported: () => mockIsPushSupported(),
  getActiveSubscription: () => mockGetActiveSubscription(),
  getStoredBirthdayChoice: (user: unknown) => mockGetStoredBirthdayChoice(user),
  notificationPermission: () => mockNotificationPermission(),
  syncPushPreferences: (user: unknown, params: unknown) => mockSyncPushPreferences(user, params),
  enableWebPush: (user: unknown) => mockEnableWebPush(user),
  disableWebPush: (user: unknown) => mockDisableWebPush(user),
  sendTestPush: () => mockSendTestPush(),
    WEB_PUSH_TIMEOUT_MS: topes.WEB_PUSH_TIMEOUT_MS,
  };
});

jest.mock('@/lib/notifications', () => ({
  areNotificationsEnabled: (...args: unknown[]) => mockAreNotificationsEnabled(...args),
  askEnableNotifications: (...args: unknown[]) => mockAskEnableNotifications(...args),
  canRequestPermissionAgain: (...args: unknown[]) => mockCanRequestPermissionAgain(...args),
  getBirthdayChoice: (...args: unknown[]) => mockGetBirthdayChoice(...args),
  requestPermissions: (...args: unknown[]) => mockRequestPermissions(...args),
  scheduleBirthdays: (...args: unknown[]) => mockScheduleBirthdays(...args),
  setBirthdayChoice: (...args: unknown[]) => mockSetBirthdayChoice(...args),
  setNotificationsEnabled: (...args: unknown[]) => mockSetNotificationsEnabled(...args),
  syncAll: (...args: unknown[]) => mockSyncAll(...args),
}));

const mockFormatInviteCode = jest.fn();
const mockInitials = jest.fn();
jest.mock('@/lib/format', () => ({
  formatInviteCode: (...args: unknown[]) => mockFormatInviteCode(...args),
  initials: (...args: unknown[]) => mockInitials(...args),
}));

const mockValidateCasaName = jest.fn();
const mockValidateInviteCode = jest.fn();
jest.mock('@/lib/validation', () => ({
  validateCasaName: (...args: unknown[]) => mockValidateCasaName(...args),
  validateInviteCode: (...args: unknown[]) => mockValidateInviteCode(...args),
}));

const user = { id: 'u1', email: 'ana@casa.com' };
const casa1: Casa = {
  id: 'c1',
  name: 'Mi Hogar',
  invite_code: 'ABCD1234',
  created_by: 'u1',
  created_at: '2026-01-01',
};
const casa2: Casa = {
  id: 'c2',
  name: 'Chalet',
  invite_code: 'EFGH5678',
  created_by: 'u1',
  created_at: '2026-02-01',
};
const ownerMember: CasaMember = {
  casa_id: 'c1',
  user_id: 'u1',
  role: 'owner',
  created_at: '2026-01-01',
};
const member2: CasaMember = {
  casa_id: 'c1',
  user_id: 'u2',
  role: 'member',
  created_at: '2026-01-02',
};
const profileCarlos: Profile = {
  id: 'u1',
  display_name: 'Carlos',
  created_at: '2026-01-01',
};
const profileAna: Profile = {
  id: 'u2',
  display_name: 'Ana',
  created_at: '2026-01-02',
};

const signOut = jest.fn();
const mockSetCurrentCasa = jest.fn();
const mockCreateCasa = jest.fn();
const mockJoinCasa = jest.fn();
const mockRenameCasa = jest.fn();
const mockDeleteCasa = jest.fn();
const mockRefreshMembers = jest.fn();

const mockInstall = jest.fn<Promise<PromptDecision>, []>()
/** Botones de Ajustes sin la tarjeta de instalar. Lo fija el test del botón. */
let botonesSinLaTarjetaDeInstalar = 0;
/**
 * Vista por defecto: la app ya instalada, que es lo que se ve en nativo.
 *
 * Los parámetros van separados porque `view` y el resto del hook son cosas
 * distintas: la plataforma y el aviso de push son de la segunda, no de la
 * primera, y mezclarlos hacía que un test creyera estar probando iPhone cuando
 * solo cambiaba un texto.
 */
function installView(
  viewOverrides: Record<string, unknown> = {},
  hookOverrides: Record<string, unknown> = {},
) {
  return {
    view: {
      visible: false,
      title: 'App instalada',
      body: 'Ya tienes MiCasa en este dispositivo, con su propio icono.',
      steps: [] as string[],
      manualSteps: [] as string[],
      action: null as string | null,
      actionIsPrompt: false,
      highlight: null as string | null,
      ...viewOverrides,
    },
    platform: 'android',
    standalone: true,
    installing: false,
    veredicto: 'ninguno' as const,
    cerrarVeredicto: jest.fn(),
    shouldAsk: false,
    decideAskAgain: jest.fn(),
    install: mockInstall,
    pushNotice: null as { title: string; body: string } | null,
    ...hookOverrides,
  };
}

function setup(
  casas: Casa[] = [casa1, casa2],
  currentCasa = casa1,
  members: CasaMember[] = [ownerMember, member2],
  profiles: Record<string, Profile | null> = { u1: profileCarlos, u2: profileAna },
  // Acepta `null` porque en web la sesión se restaura después del primer render y
  // hay tests que necesitan reproduceslo: si no, nunca se podría probar que la
  // preferencia se relee al llegar.
  currentUser: typeof user | null = user,
) {
  mockUseAuth.mockReturnValue({ user: currentUser, signOut });
  mockUseCasa.mockReturnValue({
    casas,
    currentCasa,
    members,
    profiles,
    setCurrentCasa: mockSetCurrentCasa,
    createCasa: mockCreateCasa,
    joinCasa: mockJoinCasa,
    renameCasa: mockRenameCasa,
    deleteCasa: mockDeleteCasa,
    refreshMembers: mockRefreshMembers,
  });
  mockUseRealtimeCollection.mockImplementation((_fetchFn: unknown, table: string) =>
    table === 'appointments' || table === 'contacts'
      ? { data: [], loading: false, error: null, reload: jest.fn() }
      : { data: [], loading: false, error: null, reload: jest.fn() },
  );
  return render(<AjustesScreen />);
}

beforeEach(() => {
  jest.clearAllMocks();
  // `clearAllMocks` no borra los valores que dejó un test con mockReturnValue, así
  // que el estado por defecto se fija aquí para que el orden no importes.
  mockIsPushSupported.mockReturnValue(false);
  mockSetCurrentCasa.mockResolvedValue(undefined);
  mockCreateCasa.mockResolvedValue(null);
  mockJoinCasa.mockResolvedValue(null);
  mockRenameCasa.mockResolvedValue(null);
  mockDeleteCasa.mockResolvedValue(null);
  mockRefreshMembers.mockResolvedValue(undefined);
  mockRemoveCasaMember.mockResolvedValue(null);
  mockSetCasaMemberRole.mockResolvedValue(null);
  mockFormatInviteCode.mockReturnValue('ABCD1234');
  mockInitials.mockReturnValue('CA');
  mockAreNotificationsEnabled.mockResolvedValue(true);
  mockAskEnableNotifications.mockResolvedValue('enabled');
  mockCanRequestPermissionAgain.mockResolvedValue(true);
  mockGetBirthdayChoice.mockResolvedValue('both');
  // En web la preferencia se lee de la base, así que el valor por defecto de la
  // lectura de web tiene que ser el mismo que el de la nativa: si no, los tests
  // de web pintarían un selector distinto sin querer.
  mockGetStoredBirthdayChoice.mockResolvedValue('both');
  mockRequestPermissions.mockResolvedValue(true);
  mockScheduleBirthdays.mockResolvedValue(undefined);
  mockSetBirthdayChoice.mockResolvedValue(undefined);
  mockSetNotificationsEnabled.mockResolvedValue(undefined);
  // Sin suscripción activa. Este mock no lo fijaba nadie: los tests que lo
  // necesitan lo pisan con `mockReset` + `mockResolvedValue`, y `clearAllMocks` no
  // borra implementaciones, así que esa suscripción se colaba en el test siguiente
  // y lo dejaba esperando un interruptor apagado que ya no llegaba.
  mockGetActiveSubscription.mockReset();
  mockGetActiveSubscription.mockResolvedValue(null);
  mockSyncAll.mockResolvedValue(undefined);
  mockValidateCasaName.mockReturnValue({ valid: true });
  mockValidateInviteCode.mockReturnValue({ valid: true });
  // Por defecto la instalación no se enseña, que es lo que pasa en nativo: la
  // tarjeta solo aparece en web y solo si hay algo que hacer.
  mockUseAppInstall.mockReturnValue(installView());
  // 'si' es lo que devuelve `install()` cuando se acepta el diálogo del
  // navegador. Antes ponía `true`, un booleano que no existe en el contrato: por
  // eso el bug de `if (installed)` era invisible en los tests.
  mockInstall.mockResolvedValue('si');
});

afterEach(() => {
  delete (globalThis as { alert?: unknown }).alert;
  jest.useRealTimers();
});

describe('AjustesScreen', () => {
  it('renderiza perfil y casa activa', () => {
    const { getByText, getAllByText } = setup();
    expect(getByText('Perfil')).toBeTruthy();
    expect(getAllByText('Carlos').length).toBeGreaterThanOrEqual(1);
    expect(getByText('ana@casa.com')).toBeTruthy();
    expect(getAllByText('Mi Hogar').length).toBeGreaterThanOrEqual(1);
    expect(getByText('ABCD1234')).toBeTruthy();
  });

  it('muestra miembros y sus roles', () => {
    const { getByText } = setup();
    expect(getByText('Miembros (2)')).toBeTruthy();
    expect(getByText('Administrador')).toBeTruthy();
    expect(getByText('Ana')).toBeTruthy();
  });

  it('cambia de casa activa al pulsar', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByText } = setup();

    fireEvent.press(getByText('Chalet'));

    await waitFor(() => {
      expect(mockSetCurrentCasa).toHaveBeenCalledWith(casa2);
    });
    expect(alertSpy).toHaveBeenCalledWith(
      'Casa seleccionada',
      'Ahora estás gestionando «Chalet».',
    );
    alertSpy.mockRestore();
  });

  it('abre modal y crea casa nueva', async () => {
    const { getByText, getAllByDisplayValue } = setup();

    fireEvent.press(getByText('Nueva casa'));
    await waitFor(() => {
      expect(getByText('Crear nueva casa')).toBeTruthy();
    });

    const [nameInput] = getAllByDisplayValue('');
    fireEvent.changeText(nameInput, 'Chalet de la playa');
    fireEvent.press(getByText('Crear'));

    await waitFor(() => {
      expect(mockCreateCasa).toHaveBeenCalledWith('Chalet de la playa');
    });
  });

  it('muestra errores de validación al crear casa', async () => {
    mockValidateCasaName.mockReturnValue({
      valid: false,
      message: 'El nombre de la casa es obligatorio.',
    });
    const { getByText } = setup();

    fireEvent.press(getByText('Nueva casa'));
    await waitFor(() => expect(getByText('Crear nueva casa')).toBeTruthy());

    fireEvent.press(getByText('Crear'));

    await waitFor(() => {
      expect(getByText('El nombre de la casa es obligatorio.')).toBeTruthy();
    });
    expect(mockCreateCasa).not.toHaveBeenCalled();
  });

  it('abre modal y se une por código', async () => {
    const { getByText, getAllByDisplayValue } = setup();

    fireEvent.press(getByText('Unirme por código'));
    await waitFor(() => {
      expect(getByText('Unirse a una casa')).toBeTruthy();
    });

    const [codeInput] = getAllByDisplayValue('');
    fireEvent.changeText(codeInput, 'EFGH5678');
    fireEvent.press(getByText('Unirme'));

    await waitFor(() => {
      expect(mockJoinCasa).toHaveBeenCalledWith('EFGH5678');
    });
  });

  it('cierra sesión al pulsar el botón', () => {
    const { getByText } = setup();
    fireEvent.press(getByText('Cerrar sesión'));
    expect(signOut).toHaveBeenCalled();
  });

  it('envía un aviso de prueba y lo confirma', async () => {
    const originalOs = Platform.OS;
    Platform.OS = 'web';
    mockIsPushSupported.mockReturnValue(true);
    const alertWebSpy = stubWebAlert();

    try {
      const { getByText } = setup();
      fireEvent.press(getByText('Enviar'));

      await waitFor(() => {
        expect(mockSendTestPush).toHaveBeenCalled();
      });
      expect(alertWebSpy).toHaveBeenCalledWith('Enviado a 1 navegador(es).');
    } finally {
      Platform.OS = originalOs;
    }
  });

  it('si el aviso de prueba se cuelga, el botón vuelve a estar disponible', async () => {
    // El botón de prueba tenía el mismo defecto que el interruptor: el flag de
    // "en curso" se limpiaba solo si la respuesta llegaba. Un `fetch` colgado lo
    // dejaba inutilizable hasta recargar, y es el único mecanismo para comprobar
    // que la suscripción vive.
    const originalOs = Platform.OS;
    Platform.OS = 'web';
    mockIsPushSupported.mockReturnValue(true);
    mockSendTestPush.mockImplementation(() => new Promise(() => {}));
    const alertWebSpy = stubWebAlert();

    jest.useFakeTimers();
    try {
      const { getByText } = setup();
      fireEvent.press(getByText('Enviar'));

      await act(async () => {
        jest.advanceTimersByTime(30_000);
      });

      expect(alertWebSpy).toHaveBeenCalled();
      expect(getByText('Enviar').props.accessibilityState?.busy).not.toBe(true);
    } finally {
      jest.useRealTimers();
      mockSendTestPush.mockReset();
      Platform.OS = originalOs;
    }
  });

  it('avisa de que hay que esperar si pides el aviso muy seguido', async () => {
    const originalOs = Platform.OS;
    Platform.OS = 'web';
    mockIsPushSupported.mockReturnValue(true);
    mockSendTestPush.mockResolvedValueOnce({
      ok: false,
      error: 'demasiado rapido',
      retryInSeconds: 180,
    });
    const alertWebSpy = stubWebAlert();

    try {
      const { getByText } = setup();
      fireEvent.press(getByText('Enviar'));

      await waitFor(() => {
        expect(alertWebSpy).toHaveBeenCalledWith('Puedes pedir otro aviso en 3 minuto(s).');
      });
    } finally {
      Platform.OS = originalOs;
    }
  });

  it('no ofrece el botón de prueba cuando el navegador no soporta push', () => {
    const originalOs = Platform.OS;
    Platform.OS = 'web';
    mockIsPushSupported.mockReturnValue(false);

    try {
      const { queryByText } = setup();
      expect(queryByText('Enviar')).toBeNull();
    } finally {
      Platform.OS = originalOs;
    }
  });

  describe('web: instalar la app', () => {
    it('con el evento del navegador, un boton instala con un toque', async () => {
      // El caso bueno: Chromium lanza `beforeinstallprompt` y el boton hace el
      // trabajo. Es el unico caso en el que se puede instalar tocando una vez.
      const originalOs = Platform.OS;
      Platform.OS = 'web';
      mockIsPushSupported.mockReturnValue(true);
      mockAreNotificationsEnabled.mockResolvedValue(false);
      mockUseAppInstall.mockReturnValue(
        installView({
          visible: true,
          title: 'Instala la app',
          body: 'MiCasa se puede instalar como app: se abre con su propio icono.',
          steps: [
            'Abre el menú del navegador, los tres puntos de arriba a la derecha.',
            'Toca "Instalar app" o "Añadir a pantalla de inicio".',
          ],
          manualSteps: [
            'Abre el menú del navegador, los tres puntos de arriba a la derecha.',
            'Toca "Instalar app" o "Añadir a pantalla de inicio".',
          ],
          action: 'Instalar ahora',
          actionIsPrompt: true,
        }),
      );
      const alertWebSpy = stubWebAlert();

      try {
        const { getByText, getAllByText, queryAllByRole } = setup();
        await act(async () => {});

        // Se cuentan los botones de Ajustes sin la tarjeta de instalar. Es la
        // referencia que usa el test de los pasos: la tarjeta tiene que añadir
        // exactamente un botón cuando tiene acción, y ninguno cuando no.
        botonesSinLaTarjetaDeInstalar = queryAllByRole('button').length - 1;
        // Con botón, los pasos se enseñan igualmente, debajo. Antes no se
        // enseñaban, y la tarjeta cambiaba sola de texto cuando el navegador
        // firmaba el evento.
        expect(getByText('Si prefieres hacerlo a mano, o el botón no aparece:')).toBeTruthy();

        // Y el botón va DELANTE de los pasos, que es el cambio de este bloque: la
        // tarjeta no debe reordenarse cuando el navegador firma el evento. Se
        // comprueba el orden real del árbol, no que existan las dos cosas.
        const orden = getAllByText(/Instalar ahora|Si prefieres hacerlo a mano|Abre el menú del navegador/);
        const indiceBoton = orden.findIndex((n) => n.props.children === 'Instalar ahora');
        const indicePasos = orden.findIndex((n) =>
          typeof n.props.children === 'string' && n.props.children.includes('Abre el menú'),
        );
        expect(indiceBoton).toBeGreaterThanOrEqual(0);
        expect(indicePasos).toBeGreaterThanOrEqual(0);
        expect(indiceBoton).toBeLessThan(indicePasos);
        fireEvent.press(getByText('Instalar ahora'));
        await waitFor(() => {
          expect(mockInstall).toHaveBeenCalledTimes(1);
        });
        // Antes aquí se exigía un texto con "icono" que venía de la línea
        // `if (installed)`, o sea de la mentira: el botón no puede afirmar que
        // está instalada. Lo que puede decir es que se está instalando.
        expect(mockInstall).toHaveBeenCalledTimes(1);
        // En web el alert solo lleva el cuerpo, no el título. Lo que importa es
        // que el cuerpo fala de lo que va a pasar, no de que ya está hecho.
        const dicho = String(alertWebSpy.mock.calls.at(-1)?.[0] ?? '');
        expect(dicho).toMatch(/aparecerá en tu pantalla de inicio/i);
        expect(dicho).not.toMatch(/ya tienes/i);
      } finally {
        Platform.OS = originalOs;
      }
    });

    it('si la persona no acepta, se le dice como se hace a mano y no con un boton inútil', async () => {
      // El boton se queda, pero el aviso dice dónde tocar. Un boton que no hace
      // nada es peor que no tenerlo: parece que la app está rota.
      const originalOs = Platform.OS;
      Platform.OS = 'web';
      mockIsPushSupported.mockReturnValue(true);
      mockAreNotificationsEnabled.mockResolvedValue(false);
      // Sin evento del navegador: la salida es la instrucción manual.
      mockInstall.mockResolvedValue('todavia-no');
      mockUseAppInstall.mockReturnValue(
        installView({
          visible: true,
          title: 'Instala la app',
          body: 'En iPhone la app se añade desde el menú Compartir.',
          action: 'Instalar ahora',
          actionIsPrompt: true,
          highlight: 'Abre el menú Compartir, el cuadrado con la flecha hacia arriba.',
          // Estado `instalable`: los pasos no se pintan, pero tienen que estar
          // para el aviso de cuando el boton no funciona.
          manualSteps: ['Abre el menú Compartir, el cuadrado con la flecha hacia arriba.'],
        }),
      );
      const alertWebSpy = stubWebAlert();

      try {
        const { getByText } = setup();
        await act(async () => {});

        fireEvent.press(getByText('Instalar ahora'));
        await waitFor(() => {
          // En web `showNotice` solo enseña el mensaje, asi que el titulo no
          // llega al alert. Lo que importa es que el paso sea el de esa plataforma.
          expect(alertWebSpy).toHaveBeenCalledWith(
            expect.stringContaining('Compartir'),
          );
        });
      } finally {
        Platform.OS = originalOs;
      }
    });

    it('no dice "App instalada" con ningun resultado que no sea instalar de verdad', async () => {
      // Este test es el que faltaba cuando el bug estaba vivo en produccion. La
      // linea era `if (installed)`, y `install()` devuelve un texto, asi que
      // cualquier texto era "instalada": tambien "todavia-no", que es lo que
      // pasa cuando no hay evento del navegador, o sea el caso mas comun en
      // iPhone. No lo cazaba porque el mock devolvia `false`, un booleano
      // falsy, y con `false` la linea se comportaba bien. Aqui se devuelven los
      // valores reales del contrato.
      const originalOs = Platform.OS;
      Platform.OS = 'web';
      const alertWebSpy = stubWebAlert();
      const installable = {
        visible: true,
        title: 'Instala la app',
        body: 'Se abre con su propio icono.',
        action: 'Instalar ahora',
        actionIsPrompt: true,
        manualSteps: ['Abre el menú del navegador.'],
      };

      try {
        // Los cuatro valores que `install()` puede devolver de verdad, y solo
        // esos: 'no' y 'no-preguntar-mas' son de `decideAskAgain`, no de aquí.
        // Tipado como el contrato real, no como `string`: si mañana el contrato
        // cambia, este test no compila en vez de pasar probando cualquier cosa.
        const sinInstalar: PromptDecision[] = ['todavia-no', 'cerrada', 'no-permitido'];
        for (const decision of sinInstalar) {
          alertWebSpy.mockClear();
          mockInstall.mockResolvedValue(decision);
          mockUseAppInstall.mockReturnValue(
            installView({ ...installable }, { standalone: false }),
          );
          const { getByText, unmount } = setup();
          await act(async () => {});

          expect(getByText('Instalar ahora')).toBeTruthy();
          fireEvent.press(getByText('Instalar ahora'));
          await waitFor(() => expect(alertWebSpy).toHaveBeenCalled());
          // "App instalada" solo puede aparecer con el evento `appinstalled`,
          // que reactiva la tarjeta. Nunca desde este botón.
          const dicho = alertWebSpy.mock.calls.map((c) => String(c[0])).join(' ');
          expect(dicho).not.toMatch(/ya tienes MiCasa/i);
          unmount();
        }
      } finally {
        Platform.OS = originalOs;
      }
    });

    it('el titulo y el cuerpo de la tarjeta son los del estado, no un texto fijo', async () => {
      // Los valores están fijados en la función pura, pero el enlace de la pantalla
      // a esos textos no: con un título hardcodeado, el caso "App instalada"
      // aparecería como "Instala la app" y la suite seguiría en verde.
      const originalOs = Platform.OS;
      Platform.OS = 'web';
      mockIsPushSupported.mockReturnValue(true);
      mockAreNotificationsEnabled.mockResolvedValue(false);

      try {
        mockUseAppInstall.mockReturnValue(
          installView({
            visible: true,
            title: 'App instalada',
            body: 'Ya tienes MiCasa en este dispositivo, con su propio icono.',
          }),
        );
        const installed = setup();
        await act(async () => {});
        expect(installed.getByText('App instalada')).toBeTruthy();
        expect(
          installed.getByText('Ya tienes MiCasa en este dispositivo, con su propio icono.'),
        ).toBeTruthy();
        installed.unmount();

        mockUseAppInstall.mockReturnValue(
          installView({
            visible: true,
            title: 'Instala la app',
            body: 'Se abre en su propia ventana, con su propio icono.',
            steps: [
              'Abre el menú del navegador, los tres puntos de arriba a la derecha.',
              'Si en tu navegador no aparece esa opción, guárdala en favoritos: MiCasa funciona igual.',
            ],
            manualSteps: [
              'Abre el menú del navegador, los tres puntos de arriba a la derecha.',
              'Si en tu navegador no aparece esa opción, guárdala en favoritos: MiCasa funciona igual.',
            ],
          }),
        );
        const conPasos = setup();
        await act(async () => {});
        expect(conPasos.getByText('Instala la app')).toBeTruthy();
        expect(
          conPasos.getByText('Se abre en su propia ventana, con su propio icono.'),
        ).toBeTruthy();
        // Sin botón, los pasos se muestran tal cual, sin el título de plan B que
        // solo tiene sentido cuando hay botón.
        expect(conPasos.getByText('1')).toBeTruthy();
        expect(
          conPasos.queryByText('Si prefieres hacerlo a mano, o el botón no aparece:'),
        ).toBeNull();
      } finally {
        Platform.OS = originalOs;
      }
    });

    it('con la app ya instalada, se abre la salida del acceso directo', async () => {
      // El callejon sin salida del Android: la tarjeta dice "App instalada" porque
      // la pantalla esta a pantalla completa, y eso tb pasa con un acceso directo.
      // Sin esta linea, quien tiene el acceso directo no tiene forma de conseguir
      // la app de verdad.
      const originalOs = Platform.OS;
      Platform.OS = 'web';
      mockIsPushSupported.mockReturnValue(true);
      mockAreNotificationsEnabled.mockResolvedValue(false);
      mockUseAppInstall.mockReturnValue(
        installView(
          {
            visible: true,
            title: 'App instalada',
            body: 'Ya tienes MiCasa en este dispositivo, con su propio icono.',
            atajoNoEsApp:
              '¿El icono no se comporta como una app? Añadir a pantalla de inicio desde el menú crea un acceso directo, no la app. Bórralo y usa "Instalar app": así también funcionan los avisos con el móvil bloqueado.',
          },
          { standalone: true },
        ),
      );

      try {
        const { getByText } = setup();
        await act(async () => {});

        expect(getByText('App instalada')).toBeTruthy();
        expect(
          getByText(
            '¿El icono no se comporta como una app? Añadir a pantalla de inicio desde el menú crea un acceso directo, no la app. Bórralo y usa "Instalar app": así también funcionan los avisos con el móvil bloqueado.',
          ),
        ).toBeTruthy();
      } finally {
        Platform.OS = originalOs;
      }
    });

    it('si la vista no trae pasos, el aviso de reserva dice donde mirar', async () => {
      // El boton se puede pulsar sin que la vista traiga pasos. Si el texto de
      // reserva estuviera vacio o fuera un relleno, quien lo pulse y lo vea
      // fallar se quedaria sin instruccion ninguna.
      const originalOs = Platform.OS;
      Platform.OS = 'web';
      mockIsPushSupported.mockReturnValue(true);
      mockAreNotificationsEnabled.mockResolvedValue(false);
      mockInstall.mockResolvedValue('todavia-no');
      mockUseAppInstall.mockReturnValue(
        installView({
          visible: true,
          title: 'Instala la app',
          body: 'MiCasa se puede instalar como app.',
          action: 'Instalar ahora',
          actionIsPrompt: true,
          manualSteps: [],
        }),
      );
      const alertWebSpy = stubWebAlert();

      try {
        const { getByText } = setup();
        await act(async () => {});

        fireEvent.press(getByText('Instalar ahora'));
        await waitFor(() => {
          expect(alertWebSpy).toHaveBeenCalledWith(
            'Abre el menú del navegador y elige la opción de instalar.',
          );
        });
      } finally {
        Platform.OS = originalOs;
      }
    });

    it('sin evento del navegador se enseñan los pasos numerados, sin boton', async () => {
      // iPhone y Firefox: no hay evento, no hay boton, y lo util son los pasos.
      const originalOs = Platform.OS;
      Platform.OS = 'web';
      mockIsPushSupported.mockReturnValue(true);
      mockAreNotificationsEnabled.mockResolvedValue(false);
      mockUseAppInstall.mockReturnValue(
        installView({
          visible: true,
          title: 'Instala la app',
          body: 'En iPhone la app se añade desde el menú Compartir.',
          steps: [
            'Abre el menú Compartir, el cuadrado con la flecha hacia arriba.',
            'Abajo, "Añadir a pantalla de inicio".',
          ],
          highlight: 'Abre el menú Compartir, el cuadrado con la flecha hacia arriba.',
        }),
      );

      try {
        const { getByText, queryByText, queryAllByRole } = setup();
        await act(async () => {});

        // Sin botón no hay título de "hazlo a mano": los pasos ya lo son.
        expect(queryByText('¿No te aparece el botón? Puedes hacerlo a mano:')).toBeNull();
        expect(getByText('1')).toBeTruthy();
        expect(getByText('2')).toBeTruthy();
        expect(getByText('Abre el menú Compartir, el cuadrado con la flecha hacia arriba.')).toBeTruthy();
        expect(getByText('Abajo, "Añadir a pantalla de inicio".')).toBeTruthy();
        // Sin botón, y no solo sin el texto: un botón con el título a null se
        // pinta igual, con fondo y sin nada dentro, que es peor que no pintarlo.
        // Se comparan los botones de Ajustes con los del caso anterior, que es el
        // mismo estado salvo por la tarjeta: la diferencia tiene que ser uno.
        expect(queryByText('Instalar ahora')).toBeNull();
        expect(queryAllByRole('button')).toHaveLength(botonesSinLaTarjetaDeInstalar);
      } finally {
        Platform.OS = originalOs;
      }
    });

    it('en nativo no se enseña la tarjeta', async () => {
      // En la app ya instalada no hay nada que instalar, y una tarjeta que lo
      // pidiera sería ruido.
      const { queryByText } = setup();
      await act(async () => {});

      expect(queryByText('Instala la app')).toBeNull();
      expect(queryByText('App instalada')).toBeNull();
    });

    it('en iPhone, el interruptor de avisos explica que hay que instalarla', async () => {
      // El aviso que hacia falta y nunca se veía: en iOS el push existe pero no
      // funciona en una pestaña, y el interruptor no dice por qué.
      const originalOs = Platform.OS;
      Platform.OS = 'web';
      mockIsPushSupported.mockReturnValue(true);
      mockAreNotificationsEnabled.mockResolvedValue(false);
      mockUseAppInstall.mockReturnValue(
        installView(
          {
            visible: true,
            title: 'Instala la app',
            body: 'En iPhone la app se añade desde el menú Compartir.',
            steps: ['Abre el menú Compartir.'],
            manualSteps: ['Abre el menú Compartir.'],
            highlight: 'Abre el menú Compartir.',
          },
          {
            platform: 'ios',
            standalone: false,
            pushNotice: {
              title: 'Añádela a la pantalla de inicio',
              body: 'En iPhone los avisos solo llegan si MiCasa está en la pantalla de inicio. Búscala en el menú Compartir.',
            },
          },
        ),
      );

      try {
        const { getByText } = setup();
        await act(async () => {});

        // El aviso va ademas de la descripcion, no en vez de ella: quien no sabe
        // que hace el interruptor lo pulses o no, y sin esa frase no entiende por
        // que se le pide instalar.
        expect(
          getByText('En iPhone los avisos solo llegan si MiCasa está en la pantalla de inicio. Búscala en el menú Compartir.'),
        ).toBeTruthy();
        expect(getByText('Avisos de citas y cumpleaños, aunque cierres la app')).toBeTruthy();
      } finally {
        Platform.OS = originalOs;
      }
    });
  });

  describe('web: interruptor de notificaciones', () => {
    it('avisa por el camino de web, no por Alert, cuando el permiso se deniega', async () => {
      const originalOs = Platform.OS;
      Platform.OS = 'web';
      mockIsPushSupported.mockReturnValue(true);
      mockAreNotificationsEnabled.mockResolvedValue(false);
      mockEnableWebPush.mockResolvedValue({ status: 'denied' });
      const alertWebSpy = stubWebAlert();
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

      try {
        const { getByLabelText, getByText } = setup();
        await waitFor(() => {
          expect(getByLabelText('Activar notificaciones').props.value).toBe(false);
        });

        fireEvent(getByLabelText('Activar notificaciones'), 'valueChange', true);

        await waitFor(() => {
          expect(alertWebSpy).toHaveBeenCalledWith(
            expect.stringContaining('no permite avisos en este sitio'),
          );
        });
        // `Alert.alert` es un no-op en react-native-web: si el aviso saliera por
        // ahí, el usuario no vería nada y el interruptor parecería muerto.
        expect(alertSpy).not.toHaveBeenCalled();
        expect(getByText('Permiso denegado: actívalo desde los ajustes del navegador')).toBeTruthy();
      } finally {
        alertSpy.mockRestore();
        Platform.OS = originalOs;
      }
    });

    it('si la activación falla, avisa del motivo y el interruptor vuelve a ser utilizable', async () => {
      const originalOs = Platform.OS;
      Platform.OS = 'web';
      mockIsPushSupported.mockReturnValue(true);
      mockAreNotificationsEnabled.mockResolvedValue(false);
      mockEnableWebPush.mockResolvedValue({
        status: 'failed',
        reason: 'service worker no disponible',
      });
      const alertWebSpy = stubWebAlert();

      try {
        const { getByLabelText } = setup();
        await waitFor(() => {
          expect(getByLabelText('Activar notificaciones').props.value).toBe(false);
        });

        fireEvent(getByLabelText('Activar notificaciones'), 'valueChange', true);
        // Mientras dura la activación el interruptor se bloquea a propósito.
        expect(getByLabelText('Activar notificaciones').props.disabled).toBe(true);

        await waitFor(() => {
          expect(alertWebSpy).toHaveBeenCalledWith(
            'No se pudo activar los avisos: service worker no disponible',
          );
        });

        const toggle = getByLabelText('Activar notificaciones');
        expect(toggle.props.disabled).toBe(false);
        expect(toggle.props.value).toBe(false);

        // Y se puede volver a intentarlo, que es el punto: antes había que
        // recargar la página.
        fireEvent(toggle, 'valueChange', true);
        await waitFor(() => {
          expect(mockEnableWebPush).toHaveBeenCalledTimes(2);
        });
      } finally {
        Platform.OS = originalOs;
      }
    });

    it('si la activación se cuelga, rehabilita el interruptor al vencer el tope y avisa', async () => {
      const originalOs = Platform.OS;
      Platform.OS = 'web';
      mockIsPushSupported.mockReturnValue(true);
      mockAreNotificationsEnabled.mockResolvedValue(false);
      // Promesa que no resuelve ni rechaza nunca: el caso que en Android dejaba
      // el interruptor muerto hasta recargar la página.
      mockEnableWebPush.mockImplementation(() => new Promise(() => {}));
      const alertWebSpy = stubWebAlert();

      jest.useFakeTimers();
      try {
        const { getByLabelText } = setup();
        await act(async () => {});

        expect(getByLabelText('Activar notificaciones').props.disabled).toBe(false);
        fireEvent(getByLabelText('Activar notificaciones'), 'valueChange', true);
        expect(getByLabelText('Activar notificaciones').props.disabled).toBe(true);

        await act(async () => {
          // Con el valor del espejo de arriba, no escrito a mano: si cambia el
          // presupuesto y este número se queda corto, el test pasa por no
          // agotar el tiempo y no llega a comprobar nada.
          jest.advanceTimersByTime(WEB_PUSH_TIMEOUT_MS);
        });

        expect(alertWebSpy).toHaveBeenCalledWith(MSG_PUSH_TIMEOUT);
        const toggle = getByLabelText('Activar notificaciones');
        expect(toggle.props.disabled).toBe(false);
        expect(toggle.props.value).toBe(false);
      } finally {
        jest.useRealTimers();
        Platform.OS = originalOs;
      }
    });

    it('un timeout que viene de la capa de push también avisa y rehabilita', async () => {
      // El caso anterior lo resuelve el tope externo de la pantalla. Este cubre
      // el otro camino: que sea `web-push` el que corta por su cuenta, que es lo
      // que ocurre con un diálogo de permisos o un `subscribe()` que no
      // responden, y que es lo que de verdad pasaba en Android.
      const originalOs = Platform.OS;
      Platform.OS = 'web';
      mockIsPushSupported.mockReturnValue(true);
      mockAreNotificationsEnabled.mockResolvedValue(false);
      mockEnableWebPush.mockResolvedValue({ status: 'timeout', reason: 'la activacion no ha terminado' });
      const alertWebSpy = stubWebAlert();

      try {
        const { getByLabelText } = setup();
        await act(async () => {});

        fireEvent(getByLabelText('Activar notificaciones'), 'valueChange', true);
        await act(async () => {});

        expect(alertWebSpy).toHaveBeenCalledWith(MSG_PUSH_TIMEOUT);
        const toggle = getByLabelText('Activar notificaciones');
        expect(toggle.props.disabled).toBe(false);
        expect(toggle.props.value).toBe(false);
      } finally {
        Platform.OS = originalOs;
      }
    });

    it('si el navegador no soporta push, el aviso no manda a instalar la app', async () => {
      // La copia que había aquí decía "En iPhone hace falta instalar la app en la
      // pantalla de inicio" dentro de la rama `unsupported`. Eso es inalcanzable
      // (en iPhone el navegador SÍ dice que puede) y confunde: el caso de iPhone
      // lo explica la descripción del interruptor, no este aviso. Si alguien
      // revirtiera el cambio, este test falla.
      const originalOs = Platform.OS;
      Platform.OS = 'web';
      mockIsPushSupported.mockReturnValue(true);
      mockAreNotificationsEnabled.mockResolvedValue(false);
      mockEnableWebPush.mockResolvedValue({ status: 'unsupported' } as never);
      const alertWebSpy = stubWebAlert();

      try {
        const { getByLabelText } = setup();
        await act(async () => {});

        fireEvent(getByLabelText('Activar notificaciones'), 'valueChange', true);
        await waitFor(() => {
          // En web `showNotice` solo enseña el mensaje, no el título.
          expect(alertWebSpy).toHaveBeenCalledWith('Este navegador no admite avisos push.');
        });
        expect(alertWebSpy).not.toHaveBeenCalledWith(
          expect.stringContaining('pantalla de inicio'),
        );
      } finally {
        Platform.OS = originalOs;
      }
    });

    it('un fallo al desactivar no dice que se ha activado', async () => {
      // Decir "no se pudo activar" al apagar hace creer al usuario que no ha
      // pasado nada mientras le siguen llegando avisos.
      const originalOs = Platform.OS;
      Platform.OS = 'web';
      mockIsPushSupported.mockReturnValue(true);
      mockAreNotificationsEnabled.mockResolvedValue(true);
      mockGetActiveSubscription.mockResolvedValue({ endpoint: 'https://push.test/e' } as never);
      mockDisableWebPush.mockResolvedValue({ status: 'failed', reason: 'sin red' });
      const alertWebSpy = stubWebAlert();

      try {
        const { getByLabelText } = setup();
        await act(async () => {});

        fireEvent(getByLabelText('Activar notificaciones'), 'valueChange', false);
        await act(async () => {});

        expect(alertWebSpy).toHaveBeenCalledWith(
          expect.stringContaining('No se pudo desactivar'),
        );
      } finally {
        Platform.OS = originalOs;
      }
    });

    it('una lectura del navegador que llega despues de activar no apaga el interruptor', async () => {
      // La carrera que hacia que el interruptor marcara lo contrario de lo real.
      //
      // El caso: hay una lectura del estado del navegador en vuelo (la del
      // montaje tarda 10 s en registrar el worker, y la relectura de una
      // operación anterior también puede tardar). El usuario activa los avisos,
      // el alta va bien y el interruptor se enciende; DESPUES llega la lectura
      // vieja, que se encontró sin suscripcion, y lo apaga.
      //
      // Con el numero de secuencia solo incrementado en el `finally`, esa
      // respuesta entra: el interruptor marca "desactivado" con los avisos ya
      // activados, y si la relectura buena no llega nunca, se queda asi.
      const originalOs = Platform.OS;
      Platform.OS = 'web';
      mockIsPushSupported.mockReturnValue(true);
      mockAreNotificationsEnabled.mockResolvedValue(false);
      // `clearAllMocks` no borra implementaciones ni la cola de `Once`, asi que
      // aqui se empieza de cero para que se ejecuten exactamente estas.
      mockGetActiveSubscription.mockReset();
      mockEnableWebPush.mockReset();

      // La del montaje: se queda colgada hasta que la toquemos, y cuando
      // responda dira que no hay suscripcion.
      let resolveStaleRead: ((value: unknown) => void) | undefined;
      const staleRead = new Promise((resolve) => {
        resolveStaleRead = resolve;
      });
      mockGetActiveSubscription.mockImplementationOnce(() => staleRead as never);
      // La relectura del `finally` no responde nunca: asi lo unico que puede
      // cambiar el interruptor despues es la lectura vieja.
      mockGetActiveSubscription.mockImplementationOnce(() => new Promise(() => {}) as never);

      let resolveEnable: ((value: unknown) => void) | undefined;
      mockEnableWebPush.mockImplementation(() => new Promise((resolve) => {
        resolveEnable = resolve;
      }) as never);

      const alertWebSpy = stubWebAlert();
      try {
        const { getByLabelText } = setup();
        await act(async () => {});
        expect(mockGetActiveSubscription).toHaveBeenCalledTimes(1);

        fireEvent(getByLabelText('Activar notificaciones'), 'valueChange', true);
        await act(async () => {});

        // El alta va bien: el interruptor se enciende.
        resolveEnable?.({ status: 'enabled', record: { endpoint: 'https://push.test/e' } });
        await waitFor(() => {
          expect(getByLabelText('Activar notificaciones').props.value).toBe(true);
        });

        // Y ahora llega la lectura vieja, con lo que encontro antes de que
        // existiera la suscripcion.
        resolveStaleRead?.(null);
        await act(async () => {});

        // El interruptor no se apaga: esa lectura es anterior a la activacion.
        expect(getByLabelText('Activar notificaciones').props.value).toBe(true);
        expect(alertWebSpy).not.toHaveBeenCalledWith(MSG_PUSH_TIMEOUT);
      } finally {
        Platform.OS = originalOs;
      }
    });

    it('la relectura final manda sobre lo que devolvio la operacion, si el navegador dice otra cosa', async () => {
      // El otro sentido de la relectura: un alta cortada por tiempo puede llegar
      // tarde. Si la pantalla se queda con la intencion, el interruptor
      // marca "activado" mientras el navegador no tiene suscripcion.
      //
      // Aqui la operacion va bien, y la relectura del `finally` dice que no hay
      // suscripcion. El estado real del navegador es el que gana.
      const originalOs = Platform.OS;
      Platform.OS = 'web';
      mockIsPushSupported.mockReturnValue(true);
      mockAreNotificationsEnabled.mockResolvedValue(false);
      mockGetActiveSubscription.mockReset();
      mockEnableWebPush.mockReset();
      mockGetActiveSubscription
        .mockResolvedValueOnce(null) // la del montaje
        .mockResolvedValueOnce(null); // la relectura del final
      mockEnableWebPush.mockResolvedValue({
        status: 'enabled',
        record: { endpoint: 'https://push.test/e' },
      } as never);

      stubWebAlert();
      try {
        const { getByLabelText } = setup();
        await act(async () => {});

        fireEvent(getByLabelText('Activar notificaciones'), 'valueChange', true);

        // Durante la operacion el interruptor va con la intencion...
        await waitFor(() => {
          expect(mockEnableWebPush).toHaveBeenCalledTimes(1);
        });
        // ...y cuando la relectura del navegador llega sin suscripcion, manda
        // el navegador y el interruptor se apaga.
        await waitFor(() => {
          expect(getByLabelText('Activar notificaciones').props.value).toBe(false);
        });
        expect(mockGetActiveSubscription).toHaveBeenCalledTimes(2);
      } finally {
        Platform.OS = originalOs;
      }
    });

    it('una suscripción activa no la apaga la lectura de la preferencia de cumpleaños', async () => {
      // La carrera que dejó el interruptor en `off` con los avisos funcionando.
      //
      // Las dos lecturas del montaje salen a la vez. La de la suscripción se
      // resuelve en milisegundos si el service worker ya está registrado, y la de
      // la preferencia va a la base (tope de 5 s). El `Promise.all` de la segunda
      // hace que su respuesta llegue DESPUÉS, y al llegar pintaba su `enabled`: en
      // web ese valor es un `false` fijo, porque `areNotificationsEnabled()` no
      // consulta nada en esta plataforma. El resultado era un interruptor apagado
      // sobre una suscripción viva: el push seguía llegando, porque el servidor lee
      // la fila directamente, pero la pantalla afirmaba que no.
      //
      // Con la escritura guardada con `pushReadSeq` esto se arreglaba en esta
      // pasada y volvía en cuanto llegaba un `user` nuevo, que es lo que pasa en
      // cada `TOKEN_REFRESHED`. Aquí se fija por orden, no por código: la
      // preferencia se lee, llega tarde, y el interruptor no se mueve.
      const originalOs = Platform.OS;
      Platform.OS = 'web';
      mockIsPushSupported.mockReturnValue(true);
      // Lo que devuelve en web de verdad: sin mirar nada, `false`.
      mockAreNotificationsEnabled.mockResolvedValue(false);
      mockGetActiveSubscription.mockReset();
      // Con `keys`: `getActiveSubscription` descarta la suscripción que no los
      // trae, así que un objeto sin ellos se devolvería como `null` y el test
      // estaría encendiendo el interruptor con algo que la función real nunca
      // devolvería.
      mockGetActiveSubscription.mockResolvedValue({
        endpoint: 'https://push.test/e',
        keys: { p256dh: 'k1', auth: 'k2' },
      } as never);
      // `clearAllMocks` no borra la cola de `Once`, así que aquí se empieza de
      // cero para que se ejecuten exactamente estas dos.
      mockGetStoredBirthdayChoice.mockReset();

      let resolveBirthdayRead: ((value: unknown) => void) | undefined;
      const birthdayRead = new Promise((resolve) => {
        resolveBirthdayRead = resolve;
      });
      mockGetStoredBirthdayChoice.mockImplementationOnce(() => birthdayRead as never);

      try {
        const { getByLabelText } = setup();

        // El worker ya está registrado: la lectura buena gana por mucho y enciende
        // el interruptor antes de que la de cumpleaños haya respondido.
        await waitFor(() => {
          expect(getByLabelText('Activar notificaciones').props.value).toBe(true);
        });

        // Y solo ahora responde la lectura de la base.
        resolveBirthdayRead?.('both');
        await act(async () => {});

        // La fila dice "ambos" y el interruptor sigue encendido.
        expect(getByLabelText('Activar notificaciones').props.value).toBe(true);
        expect(mockGetStoredBirthdayChoice).toHaveBeenCalledWith(user);
      } finally {
        Platform.OS = originalOs;
      }
    });
  });

  describe('web: la preferencia de cumpleaños se lee de la base', () => {
    // El fallo que este bloque arregla: en web la preferencia se replica en
    // `push_preferences` (es la que lee el servidor para avisar con la app
    // cerrada) y la lectura venía de `getBirthdayChoice`, que en web devuelve
    // 'none' siempre. Se guardaba bien y al reabrir Ajustes volvía a "sin
    // aviso", sin error y sin rastro.
    it('el selector arranca con lo que hay guardado en la base', async () => {
      const originalOs = Platform.OS;
      Platform.OS = 'web';
      mockIsPushSupported.mockReturnValue(true);
      // Lo que devolvía la lectura de plataforma: 'none' fijo, que es lo que
      // hacía que el selector no reflejara nada.
      mockGetBirthdayChoice.mockResolvedValue('none');
      mockGetStoredBirthdayChoice.mockResolvedValue('day-before');

      try {
        const { getByRole } = setup();

        await waitFor(() => {
          expect(
            getByRole('radio', { name: 'Día antes' }).props.accessibilityState.checked,
          ).toBe(true);
        });
        expect(getByRole('radio', { name: 'Sin aviso' }).props.accessibilityState.checked).toBe(
          false,
        );
        // Y se le pregunta con la sesión, no sin ella: una lectura hecha sin
        // usuario devuelve 'none' y el selector se queda mintiendo.
        expect(mockGetStoredBirthdayChoice).toHaveBeenCalledWith(user);
        // En web no se toca AsyncStorage, que es la lectura de nativo.
        expect(mockGetBirthdayChoice).not.toHaveBeenCalled();
      } finally {
        Platform.OS = originalOs;
      }
    });

    it('en nativo se sigue leyendo de AsyncStorage', async () => {
      mockGetBirthdayChoice.mockResolvedValue('same-day');

      const { getByRole } = setup();

      await waitFor(() => {
        expect(getByRole('radio', { name: 'Mismo día' }).props.accessibilityState.checked).toBe(
          true,
        );
      });
      expect(mockGetStoredBirthdayChoice).not.toHaveBeenCalled();
    });

    it('una lectura que no sabe no marca ningún chip y no escribe al pulsarlo', async () => {
      // El fallo dangerous: con un repliegue a 'none', el chip "Sin aviso" salía
      // marcado como si fuera el valor real, y pulsarlo para "confirmarlo"
      // escribía 'none' encima de una fila que podía seguir en 'both'. El
      // servidor dejaba de avisar y la pantalla no había dicho nada.
      //
      // Por eso el repliegue es `null` y no `'none'`: sin nada marcado no hay
      // chip marcado que alguien pulsaría creyendo que solo confirma.
      const originalOs = Platform.OS;
      Platform.OS = 'web';
      mockIsPushSupported.mockReturnValue(true);
      mockGetStoredBirthdayChoice.mockResolvedValue(null);

      try {
        const { getByRole, getByText } = setup();

        await waitFor(() => {
          expect(getByText(/No se ha podido leer el aviso/)).toBeTruthy();
        });
        // Ningún chip marcado, y el que habríafst responsible de escribir 'none'
        // aparece como el que está.
        for (const name of ['Sin aviso', 'Día antes', 'Mismo día', 'Día antes + mismo día']) {
          expect(getByRole('radio', { name }).props.accessibilityState.checked).toBe(false);
        }

        await act(async () => {
          fireEvent.press(getByRole('radio', { name: 'Sin aviso' }));
        });

        // Ahora sí escribe, porque el usuario lo ha elegido explícitamente.
        expect(mockSyncPushPreferences).toHaveBeenCalledWith(user, { birthdayChoice: 'none' });
      } finally {
        Platform.OS = originalOs;
      }
    });

    it('pulsar el chip que ya está marcado no escribe nada', async () => {
      // La segunda mitad del mismo fallo. Con la fila en 'both' y el chip
      // 'Ambos' marcado, confirmarlo no debería generar un `upsert`: sin este
      // caso, un toque inocente reescribe la fila y la desincroniza.
      const originalOs = Platform.OS;
      Platform.OS = 'web';
      mockIsPushSupported.mockReturnValue(true);
      mockGetStoredBirthdayChoice.mockResolvedValue('both');

      try {
        const { getByRole } = setup();

        await waitFor(() => {
          expect(
          getByRole('radio', { name: 'Día antes + mismo día' }).props.accessibilityState.checked,
        ).toBe(true);
        });
        expect(mockSyncPushPreferences).not.toHaveBeenCalled();

        await act(async () => {
          fireEvent.press(getByRole('radio', { name: 'Día antes + mismo día' }));
        });

        expect(mockSyncPushPreferences).not.toHaveBeenCalled();
      } finally {
        Platform.OS = originalOs;
      }
    });

    it('una lectura de web que falla deja los controles utilizables', async () => {
      // Un rechazo dentro del IIFE de montaje dejaba `prefsLoading` en `true` para
      // siempre, con el interruptor bloqueado y sin nada que lo explique.
      //
      // El rechazo va en la lectura de la base, que es la que puede fallar en
      // esta plataforma. `areNotificationsEnabled` ya no se llama aquí: devuelve
      // `false` fijo sin consultar nada, así que no puede rechazar nunca, y un
      // test que la haga rejecting daba confianza sobre un camino imposible.
      const originalOs = Platform.OS;
      Platform.OS = 'web';
      mockIsPushSupported.mockReturnValue(true);
      mockGetStoredBirthdayChoice.mockRejectedValueOnce(new Error('sin red'));
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      try {
        const { getByLabelText } = setup();

        await waitFor(() => {
          expect(getByLabelText('Activar notificaciones').props.disabled).toBe(false);
        });
        expect(getByLabelText('Activar notificaciones').props.value).toBe(false);
        // Y el motivo queda anotado, no se traga en silencio.
        expect(warn).toHaveBeenCalledWith(
          'No se pudo leer la preferencia de cumpleaños',
          'sin red',
        );
      } finally {
        warn.mockRestore();
        Platform.OS = originalOs;
      }
    });

    it('en nativo, una lectura que falla deja los controles utilizables', async () => {
      // El guard real de esta pantalla en nativo es AsyncStorage, no la base. Con
      // dos lecturas en paralelo y un contador que las espera a las dos, este es
      // el caso que decide si el interruptor se rehabilita: si una sola cuelga o
      // rechaza, el `prefsLoading` tiene que pasar a `false` igual.
      mockAreNotificationsEnabled.mockRejectedValueOnce(new Error('sin red'));
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      try {
        const { getByLabelText } = setup();

        await waitFor(() => {
          expect(getByLabelText('Activar notificaciones').props.disabled).toBe(false);
        });
        expect(warn).toHaveBeenCalledWith(
          'No se pudo leer el estado de las notificaciones',
          'sin red',
        );
      } finally {
        warn.mockRestore();
      }
    });

    it('en nativo, una lectura en vuelo del maestro no revive un interruptor apagado', async () => {
      // La carrera que reintrodujo el efecto al llevar `user` en las dependencias:
      // en nativo el maestro se escribía sin secuencia, así que una lectura de
      // AsyncStorage todavía en vuelo podía encender el interruptor encima de lo
      // que el usuario acababa de apagar. `masterReadSeq` lo cierra.
      let resolveEnabled: ((value: boolean) => void) | undefined;
      mockAreNotificationsEnabled.mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            resolveEnabled = resolve;
          }),
      );

      const { getByLabelText } = setup();

      await act(async () => {
        fireEvent(getByLabelText('Activar notificaciones'), 'valueChange', false);
      });
      expect(getByLabelText('Activar notificaciones').props.value).toBe(false);

      // Ahora responde la lectura vieja, con el `true` de antes del toque.
      await act(async () => {
        resolveEnabled?.(true);
      });

      expect(getByLabelText('Activar notificaciones').props.value).toBe(false);
    });

    it('el interruptor maestro sobrevive a la sesión que llega tarde', async () => {
      // Por dónde volvía el fallo que este bloque arregla. En web el interruptor
      // lo escribe la lectura de la suscripción, y cada vez que el efecto de
      // preferencias volvía a correr con un `user` nuevo se lo llevaba por delante
      // con el `false` fijo de `areNotificationsEnabled()`. Un `TOKEN_REFRESHED`
      // entrega otro objeto con el mismo `id`, así que no hace falta nada raro para
      // reproducirlo: basta con el mismo componente receiving la sesión después.
      // Guardar esa escritura con `pushReadSeq` lo tapaba en la primera pasada y lo
      // dejaba pasar en esta, que es la que llega a producción.
      const originalOs = Platform.OS;
      Platform.OS = 'web';
      mockIsPushSupported.mockReturnValue(true);
      mockAreNotificationsEnabled.mockResolvedValue(false);
      mockGetActiveSubscription.mockReset();
      mockGetActiveSubscription.mockResolvedValue({
        endpoint: 'https://push.test/e',
        keys: { p256dh: 'k1', auth: 'k2' },
      } as never);

      try {
        const screen = setup([casa1], casa1, [ownerMember], { u1: profileCarlos }, null);

        // Sin sesión todavía, pero con la suscripción ya viva: la lectura del
        // navegador no depende de la sesión, así que el interruptor se enciende
        // igual y ya no depende de que llegue el `user`.
        await waitFor(() => {
          expect(screen.getByLabelText('Activar notificaciones').props.disabled).toBe(false);
        });
        expect(screen.getByLabelText('Activar notificaciones').props.value).toBe(true);

        // Llega la sesión: el efecto de preferencias corre por segunda vez con un
        // `user` nuevo, y el interruptor no se mueve.
        mockUseAuth.mockReturnValue({ user, signOut });
        screen.rerender(<AjustesScreen />);
        await act(async () => {});

        expect(mockGetStoredBirthdayChoice).toHaveBeenNthCalledWith(2, user);
        expect(screen.getByLabelText('Activar notificaciones').props.value).toBe(true);
      } finally {
        Platform.OS = originalOs;
      }
    });

    it('la preferencia se vuelve a leer cuando la sesión llega después del primer render', async () => {
      // En web la sesión se restaura desde el almacenamiento, así que el primer
      // render puede venir sin usuario. Una lectura hecha así devuelve 'none' sin
      // consultar, y si no se repitiera al llegar la sesión el selector se
      // quedaría en "sin aviso" durante toda la vida de la pestaña.
      const originalOs = Platform.OS;
      Platform.OS = 'web';
      mockIsPushSupported.mockReturnValue(true);
      // `clearAllMocks` no borra la cola de `Once`, así que aquí se empieza de
      // cero para que se ejecuten exactamente estas dos.
      mockGetStoredBirthdayChoice.mockReset();
      mockGetStoredBirthdayChoice
        .mockResolvedValueOnce('none') // lo que ve el primer render, sin sesión
        .mockResolvedValueOnce('day-before'); // lo que hay de verdad en la fila

      try {
        // Los cuatro valores anteriores no influyen en lo que se prueba aquí; el
        // que importa es el quinto, la sesión ausente en el primer render.
        const screen = setup([casa1], casa1, [ownerMember], { u1: profileCarlos }, null);
        await act(async () => {});

        expect(mockGetStoredBirthdayChoice).toHaveBeenNthCalledWith(1, null);
        expect(
          screen.getByRole('radio', { name: 'Sin aviso' }).props.accessibilityState.checked,
        ).toBe(true);

        // Llega la sesión y el mismo componente se vuelve a pintar. Si el efecto
        // no la tuviera en sus dependencias, esta segunda pasada no existiría y
        // el selector se quedaría en "sin aviso" para siempre.
        mockUseAuth.mockReturnValue({ user, signOut });
        screen.rerender(<AjustesScreen />);

        await waitFor(() => {
          expect(
            screen.getByRole('radio', { name: 'Día antes' }).props.accessibilityState.checked,
          ).toBe(true);
        });
        expect(mockGetStoredBirthdayChoice).toHaveBeenNthCalledWith(2, user);
        expect(
          screen.getByRole('radio', { name: 'Sin aviso' }).props.accessibilityState.checked,
        ).toBe(false);
      } finally {
        Platform.OS = originalOs;
      }
    });

    it('una escritura que falla devuelve el chip a lo que había', async () => {
      // La fila de la base es la buena. Si el `upsert` no llega, el chip no puede
      // quedar marcando lo que el usuario acaba de pulsar: quedaría la pantalla
      // afirmando una preferencia que el servidor no tiene, hasta el próximo
      // montaje. Y no se revierte a `'none'` sino a lo que había, porque `null` es
      // "no se sabe" y volver a un valor inventado repite el fallo del bloque.
      const originalOs = Platform.OS;
      Platform.OS = 'web';
      mockIsPushSupported.mockReturnValue(true);
      mockGetStoredBirthdayChoice.mockResolvedValue('both');
      mockSyncPushPreferences.mockRejectedValueOnce(new Error('sin red'));
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      try {
        const { getByRole } = setup();

        await waitFor(() => {
          expect(
            getByRole('radio', { name: 'Día antes + mismo día' }).props.accessibilityState.checked,
          ).toBe(true);
        });

        await act(async () => {
          fireEvent.press(getByRole('radio', { name: 'Mismo día' }));
        });

        // Vuelve a lo que decía la fila, y el motivo queda anotado.
        expect(getByRole('radio', { name: 'Día antes + mismo día' }).props.accessibilityState.checked).toBe(
          true,
        );
        expect(getByRole('radio', { name: 'Mismo día' }).props.accessibilityState.checked).toBe(
          false,
        );
        expect(warn).toHaveBeenCalledWith(
          'No se pudo guardar el aviso de cumpleaños elegido',
          'sin red',
        );
      } finally {
        warn.mockRestore();
        Platform.OS = originalOs;
      }
    });

    it('el interruptor se rehabilita aunque una lectura quede obsoleta en vuelo', async () => {
      // La fuga del contador. El efecto se reejecuta cada vez que llega un `user`
      // nuevo (un `TOKEN_REFRESHED` entrega otro objeto con el mismo `id`), así que
      // una pasada puede quedarse obsoleta con su lectura todavía en vuelo. Con el
      // contador compartido en el componente, su `release` salía temprano por la
      // guarda `active` y el cupo no se devolvía: el contador subía sin
      // techo, `setPrefsLoading(false)` dejaba de ejecutarse y el interruptor
      // quedaba bloqueado hasta recargar, sin mensaje y sin recuperación.
      //
      // Ningún otro test monta esta combinación: siempre dejan resolver la primera
      // lectura antes del `rerender`.
      const originalOs = Platform.OS;
      Platform.OS = 'web';
      mockIsPushSupported.mockReturnValue(true);
      mockGetStoredBirthdayChoice.mockReset();

      let resolveStale: ((value: string | null) => void) | undefined;
      let resolveFresh: ((value: string | null) => void) | undefined;
      mockGetStoredBirthdayChoice.mockReset();
      mockGetStoredBirthdayChoice
        .mockImplementationOnce(
          () =>
            new Promise<string | null>((resolve) => {
              resolveStale = resolve;
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise<string | null>((resolve) => {
              resolveFresh = resolve;
            }),
        );

      try {
        // Primer render sin sesión, y su lectura se queda en vuelo.
        const screen = setup([casa1], casa1, [ownerMember], { u1: profileCarlos }, null);
        await act(async () => {});
        expect(screen.getByLabelText('Activar notificaciones').props.disabled).toBe(true);

        // Llega la sesión antes de que responda la anterior: la pasada vieja queda
        // obsoleta con su lectura viva.
        mockUseAuth.mockReturnValue({ user, signOut });
        screen.rerender(<AjustesScreen />);
        await act(async () => {});

        // La pasada obsoleta es la primera en soltar su cupo, y no puede
        // habilitar el interruptor: la lectura que sigue en vuelo es la que decide
        // el valor que se pinta, y habilitarla antes dejaría el `Switch` con un
        // estado que aún no se sabe.
        await act(async () => {
          resolveStale?.('both');
        });
        expect(screen.getByLabelText('Activar notificaciones').props.disabled).toBe(true);

        // Ahora sí, con la vigente resuelta.
        await act(async () => {
          resolveFresh?.('day-before');
        });
        await waitFor(() => {
          expect(screen.getByLabelText('Activar notificaciones').props.disabled).toBe(false);
        });
        expect(screen.getByRole('radio', { name: 'Día antes' }).props.accessibilityState.checked).toBe(
          true,
        );
      } finally {
        Platform.OS = originalOs;
      }
    });

    it('una lectura en vuelo no pisa el chip que el usuario acaba de pulsar', async () => {
      // La carrera que este arreglo cierra. La lectura de `push_preferences`
      // tiene un tope de cinco segundos, así que puede seguir en vuelo cuando el
      // usuario ya está pulsando; y el selector no mira `prefsLoading`, que solo
      // deshabilita el interruptor maestro, así que está activo desde el primer
      // render.
      //
      // El caso: la lectura arrancada antes de la pulsación responde después con
      // lo que había en la fila. Si su respuesta entra, el chip recién marcado
      // desaparece y la pantalla afirma "sin aviso" con la fila en "ambos": el
      // servidor sigue mandando el aviso con el nombre y la fecha del contacto
      // mientras la UI jura que no avisa de nada.
      const originalOs = Platform.OS;
      Platform.OS = 'web';
      mockIsPushSupported.mockReturnValue(true);
      mockGetStoredBirthdayChoice.mockReset();

      let resolveStaleRead: ((value: unknown) => void) | undefined;
      const staleRead = new Promise((resolve) => {
        resolveStaleRead = resolve;
      });
      mockGetStoredBirthdayChoice.mockImplementationOnce(() => staleRead as never);

      try {
        const { getByRole } = setup();

        // La lectura sigue en vuelo y el selector ya es utilizable. Con la lectura
        // sin responder no se marca ningún chip: `null` es "no se sabe", no
        // "sin aviso".
        await act(async () => {});
        for (const name of ['Sin aviso', 'Día antes', 'Mismo día', 'Día antes + mismo día']) {
          expect(getByRole('radio', { name }).props.accessibilityState.checked).toBe(false);
        }

        // El usuario elige mientras tanto.
        fireEvent.press(getByRole('radio', { name: 'Día antes' }));
        await act(async () => {});
        expect(getByRole('radio', { name: 'Día antes' }).props.accessibilityState.checked).toBe(true);
        expect(mockSyncPushPreferences).toHaveBeenCalledWith(user, { birthdayChoice: 'day-before' });

        // Y solo ahora responde la lectura vieja, con lo que encontró antes de
        // que existiera esa elección.
        resolveStaleRead?.('both');
        await act(async () => {});

        expect(getByRole('radio', { name: 'Día antes' }).props.accessibilityState.checked).toBe(true);
        expect(
          getByRole('radio', { name: 'Día antes + mismo día' }).props.accessibilityState.checked,
        ).toBe(false);
      } finally {
        Platform.OS = originalOs;
      }
    });

    it('una relectura que empieza después de un toque no se descarta', async () => {
      // La otra mitad del patrón: el contador se mueve al *entrar* en el efecto
      // y no solo al pulsar un chip. Si solo se moviera al pulsar, esta lectura
      // llevaría un número viejo y su respuesta se tiraría, que es peor que la
      // carrera anterior: la fila real no llegaría nunca a la pantalla.
      //
      // El caso: se elige "sin aviso" y la escritura falla, así que la fila se
      // sigue quedando en "ambos". Llega la sesión —un `TOKEN_REFRESHED` devuelve
      // un objeto nuevo con el mismo `id`— y la relectura sí tiene que poder
      // escribir, porque es la buena.
      const originalOs = Platform.OS;
      Platform.OS = 'web';
      mockIsPushSupported.mockReturnValue(true);
      mockGetStoredBirthdayChoice.mockReset();
      mockGetStoredBirthdayChoice
        .mockResolvedValueOnce('both') // el montaje
        .mockResolvedValueOnce('both'); // la relectura: la fila nunca cambió
      mockSyncPushPreferences.mockRejectedValueOnce(new Error('sin red'));

      try {
        const screen = setup();

        await waitFor(() => {
          expect(
            screen.getByRole('radio', { name: 'Día antes + mismo día' }).props.accessibilityState
              .checked,
          ).toBe(true);
        });

        fireEvent.press(screen.getByRole('radio', { name: 'Sin aviso' }));
        await act(async () => {});
        // La escritura falla, así que el chip vuelve a lo que decía la fila. Antes
        // se pintaba de forma optimista y se dejaba así: la pantalla acababa
        // afirmar "sin aviso" con la fila en "ambos", que es justo lo que el
        // servidor sigue avisando.
        expect(
          screen.getByRole('radio', { name: 'Día antes + mismo día' }).props.accessibilityState
            .checked,
        ).toBe(true);
        expect(
          screen.getByRole('radio', { name: 'Sin aviso' }).props.accessibilityState.checked,
        ).toBe(false);

        // Mismo usuario, objeto nuevo: el efecto vuelve a correr.
        const refreshedUser = { ...user };
        mockUseAuth.mockReturnValue({ user: refreshedUser, signOut });
        screen.rerender(<AjustesScreen />);

        await waitFor(() => {
          expect(
            screen.getByRole('radio', { name: 'Día antes + mismo día' }).props.accessibilityState
              .checked,
          ).toBe(true);
        });
        expect(
          screen.getByRole('radio', { name: 'Sin aviso' }).props.accessibilityState.checked,
        ).toBe(false);
      } finally {
        Platform.OS = originalOs;
      }
    });
  });

  it('da de baja la suscripción push antes de cerrar sesión', async () => {
    const originalOs = Platform.OS;
    Platform.OS = 'web';
    try {
    const { getByText } = setup();
    fireEvent.press(getByText('Cerrar sesión'));

    await waitFor(() => {
      expect(mockDisableWebPush).toHaveBeenCalledWith(user);
    });
    expect(mockDisableWebPush.mock.invocationCallOrder[0]).toBeLessThan(
      signOut.mock.invocationCallOrder[0],
    );
    } finally {
      Platform.OS = originalOs;
    }
  });

  it('cierra sesión aunque la baja push falle', async () => {
    const originalOs = Platform.OS;
    Platform.OS = 'web';
    mockDisableWebPush.mockRejectedValueOnce(new Error('sin red'));

    try {
      const { getByText } = setup();
      fireEvent.press(getByText('Cerrar sesión'));

      await waitFor(() => {
        expect(signOut).toHaveBeenCalled();
      });
    } finally {
      Platform.OS = originalOs;
    }
  });

  it('owner ve controles de gestión para otros miembros', () => {
    const { getByLabelText, queryByLabelText } = setup();
    expect(getByLabelText('Hacer administrador')).toBeTruthy();
    expect(getByLabelText('Eliminar a Ana')).toBeTruthy();
    expect(queryByLabelText('Eliminar a Carlos')).toBeNull();
  });

  it('owner elimina miembro tras confirmar', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByLabelText } = setup();

    fireEvent.press(getByLabelText('Eliminar a Ana'));

    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    const confirm = buttons.find((b) => b.text === 'Eliminar');
    await confirm?.onPress?.();

    await waitFor(() => {
      expect(mockRemoveCasaMember).toHaveBeenCalledWith('c1', 'u2');
      expect(mockRefreshMembers).toHaveBeenCalled();
    });
    alertSpy.mockRestore();
  });

  it('owner promueve miembro a admin tras confirmar', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByLabelText } = setup();

    fireEvent.press(getByLabelText('Hacer administrador'));

    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    const confirm = buttons.find((b) => b.text === 'Confirmar');
    await confirm?.onPress?.();

    await waitFor(() => {
      expect(mockSetCasaMemberRole).toHaveBeenCalledWith('c1', 'u2', 'admin');
      expect(mockRefreshMembers).toHaveBeenCalled();
    });
    alertSpy.mockRestore();
  });

  it('owner edita casa tras abrir modal', async () => {
    const { getByText, getByLabelText, getByDisplayValue } = setup();

    fireEvent.press(getByLabelText('Editar casa Mi Hogar'));
    await waitFor(() => {
      expect(getByText('Editar casa')).toBeTruthy();
    });

    const nameInput = getByDisplayValue('Mi Hogar');
    fireEvent.changeText(nameInput, 'Hogar renovado');
    fireEvent.press(getByText('Guardar cambios'));

    await waitFor(() => {
      expect(mockRenameCasa).toHaveBeenCalledWith('c1', 'Hogar renovado');
    });
  });

  it('owner elimina casa tras confirmar', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByLabelText } = setup();

    fireEvent.press(getByLabelText('Eliminar casa Mi Hogar'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Eliminar casa',
      expect.any(String),
      expect.any(Array),
    );
    const buttons = alertSpy.mock.calls[0][2] as
      | { text: string; onPress?: () => void }[]
      | undefined;
    const deleteButton = buttons?.find((b) => b.text === 'Eliminar');
    await deleteButton?.onPress?.();

    await waitFor(() => {
      expect(mockDeleteCasa).toHaveBeenCalledWith('c1');
    });
    alertSpy.mockRestore();
  });

  it('no-owner no ve acciones de editar/borrar casas', () => {
    const { queryByLabelText } = setup(
      [casa1, casa2],
      casa1,
      [ownerMember, member2],
      { u1: profileCarlos, u2: profileAna },
      { id: 'u2', email: 'ana@casa.com' } as never,
    );
    expect(queryByLabelText('Editar casa Mi Hogar')).toBeNull();
    expect(queryByLabelText('Eliminar casa Mi Hogar')).toBeNull();
  });

  it('no-owner no ve controles de gestión', () => {
    const { queryByLabelText } = setup(
      [casa1, casa2],
      casa1,
      [ownerMember, member2],
      { u1: profileCarlos, u2: profileAna },
      { id: 'u2', email: 'ana@casa.com' } as never,
    );
    expect(queryByLabelText('Hacer administrador')).toBeNull();
    expect(queryByLabelText('Eliminar a Carlos')).toBeNull();
  });

  it('renderiza sección Recordatorios con preferencias cargadas', async () => {
    const { getByText, getByLabelText } = setup();
    await waitFor(() => {
      expect(getByText('Recordatorios')).toBeTruthy();
      expect(getByText('Cumpleaños: avisar')).toBeTruthy();
      expect(getByText('Día antes + mismo día')).toBeTruthy();
    });
    expect(getByLabelText('Activar notificaciones').props.value).toBe(true);
  });

  it('activa notificaciones pidiendo permiso y sincronizando', async () => {
    mockAreNotificationsEnabled.mockResolvedValue(false);
    const { getByLabelText } = setup();
    await waitFor(() => {
      expect(getByLabelText('Activar notificaciones').props.value).toBe(false);
    });

    fireEvent(getByLabelText('Activar notificaciones'), 'valueChange', true);

    await waitFor(() => {
      expect(mockRequestPermissions).toHaveBeenCalled();
      expect(mockSetNotificationsEnabled).toHaveBeenCalledWith(true);
      expect(mockSyncAll).toHaveBeenCalled();
    });
  });

  it('desactiva notificaciones y cancela todo', async () => {
    const { getByLabelText } = setup();
    await waitFor(() => {
      expect(getByLabelText('Activar notificaciones').props.value).toBe(true);
    });

    fireEvent(getByLabelText('Activar notificaciones'), 'valueChange', false);

    await waitFor(() => {
      expect(mockSetNotificationsEnabled).toHaveBeenCalledWith(false);
    });
    expect(mockSyncAll).not.toHaveBeenCalled();
  });

  it('toggle: error muestra Alert y switch no se mueve (regresión catch silencioso)', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockAreNotificationsEnabled.mockResolvedValue(false);
    mockRequestPermissions.mockRejectedValue(new Error('boom'));
    const { getByLabelText } = setup();
    await waitFor(() => {
      expect(getByLabelText('Activar notificaciones').props.value).toBe(false);
    });

    fireEvent(getByLabelText('Activar notificaciones'), 'valueChange', true);

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Error',
        'No se pudo cambiar el estado de las notificaciones.',
      );
    });
    expect(getByLabelText('Activar notificaciones').props.value).toBe(false);
    expect(mockSetNotificationsEnabled).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('toggle: permiso denegado sin canAskAgain ofrece Abrir ajustes y switch no se mueve', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockAreNotificationsEnabled.mockResolvedValue(false);
    mockRequestPermissions.mockResolvedValue(false);
    mockCanRequestPermissionAgain.mockResolvedValue(false);
    const { getByLabelText } = setup();
    await waitFor(() => {
      expect(getByLabelText('Activar notificaciones').props.value).toBe(false);
    });

    fireEvent(getByLabelText('Activar notificaciones'), 'valueChange', true);

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Permiso denegado',
        expect.any(String),
        expect.any(Array),
      );
    });
    const buttons = alertSpy.mock.calls[0][2] as
      | { text: string; onPress?: () => void }[]
      | undefined;
    expect(buttons?.some((b) => b.text === 'Abrir ajustes')).toBe(true);
    expect(getByLabelText('Activar notificaciones').props.value).toBe(false);
    expect(mockSetNotificationsEnabled).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('elegir cumpleaños sin notif activadas pide activar y no cambia si cancela', async () => {
    mockAreNotificationsEnabled.mockResolvedValue(false);
    mockAskEnableNotifications.mockResolvedValue('cancelled');
    const { getByText } = setup();
    await waitFor(() => {
      expect(getByText('Cumpleaños: avisar')).toBeTruthy();
    });

    fireEvent.press(getByText('Mismo día'));

    await waitFor(() => {
      expect(mockAskEnableNotifications).toHaveBeenCalled();
    });
    expect(mockSetBirthdayChoice).not.toHaveBeenCalled();
    expect(mockScheduleBirthdays).not.toHaveBeenCalled();
  });

  it('cambia aviso de cumpleaños y reprograma', async () => {
    const { getByText } = setup();
    await waitFor(() => {
      expect(getByText('Cumpleaños: avisar')).toBeTruthy();
    });

    fireEvent.press(getByText('Mismo día'));

    await waitFor(() => {
      expect(mockSetBirthdayChoice).toHaveBeenCalledWith('same-day');
      expect(mockScheduleBirthdays).toHaveBeenCalledWith([], 'same-day');
    });
  });
});