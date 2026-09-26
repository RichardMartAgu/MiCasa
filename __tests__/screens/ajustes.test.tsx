import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, Platform } from 'react-native';

import AjustesScreen from '@/app/(tabs)/ajustes';
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
const mockNotificationPermission = jest.fn(() => 'default' as const);
const mockSyncPushPreferences = jest.fn(async () => undefined);
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

jest.mock('@/lib/web-push', () => ({
  isPushSupported: () => mockIsPushSupported(),
  getActiveSubscription: () => mockGetActiveSubscription(),
  notificationPermission: () => mockNotificationPermission(),
  syncPushPreferences: (_user: unknown, _params: unknown) => mockSyncPushPreferences(),
  enableWebPush: (user: unknown) => mockEnableWebPush(user),
  disableWebPush: (user: unknown) => mockDisableWebPush(user),
  sendTestPush: () => mockSendTestPush(),
  // Espejo del valor real (PERMISSION 60s + ACTIVATION 30s + 10s de margen), que
  // fija `__tests__/lib/web-push.test.ts`. No se importa el módulo de verdad
  // porque al cargarse abre un cliente de Supabase y aquí solo hacen falta las
  // funciones de web-push que ya van simuladas.
  WEB_PUSH_TIMEOUT_MS: 100_000,
}));

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

const mockInstall = jest.fn(async () => true);
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
  currentUser = user,
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
  mockRequestPermissions.mockResolvedValue(true);
  mockScheduleBirthdays.mockResolvedValue(undefined);
  mockSetBirthdayChoice.mockResolvedValue(undefined);
  mockSetNotificationsEnabled.mockResolvedValue(undefined);
  mockSyncAll.mockResolvedValue(undefined);
  mockValidateCasaName.mockReturnValue({ valid: true });
  mockValidateInviteCode.mockReturnValue({ valid: true });
  // Por defecto la instalación no se enseña, que es lo que pasa en nativo: la
  // tarjeta solo aparece en web y solo si hay algo que hacer.
  mockUseAppInstall.mockReturnValue(installView());
  mockInstall.mockResolvedValue(true);
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
        expect(alertWebSpy).toHaveBeenCalledWith(expect.stringContaining('icono'));
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
      mockInstall.mockResolvedValue(false);
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
      mockInstall.mockResolvedValue(false);
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
          jest.advanceTimersByTime(100_000);
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