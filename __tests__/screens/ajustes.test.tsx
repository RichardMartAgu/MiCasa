import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

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

const mockRemoveCasaMember = jest.fn();
const mockSetCasaMemberRole = jest.fn();
jest.mock('@/lib/api', () => ({
  fetchAppointments: jest.fn(),
  fetchContacts: jest.fn(),
  removeCasaMember: (...args: unknown[]) => mockRemoveCasaMember(...args),
  setCasaMemberRole: (...args: unknown[]) => mockSetCasaMemberRole(...args),
}));

const mockAreNotificationsEnabled = jest.fn();
const mockGetBirthdayChoice = jest.fn();
const mockRequestPermissions = jest.fn();
const mockScheduleBirthdays = jest.fn();
const mockSetBirthdayChoice = jest.fn();
const mockSetNotificationsEnabled = jest.fn();
const mockSyncAll = jest.fn();
jest.mock('@/lib/notifications', () => ({
  areNotificationsEnabled: (...args: unknown[]) => mockAreNotificationsEnabled(...args),
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
  mockGetBirthdayChoice.mockResolvedValue('both');
  mockRequestPermissions.mockResolvedValue(true);
  mockScheduleBirthdays.mockResolvedValue(undefined);
  mockSetBirthdayChoice.mockResolvedValue(undefined);
  mockSetNotificationsEnabled.mockResolvedValue(undefined);
  mockSyncAll.mockResolvedValue(undefined);
  mockValidateCasaName.mockReturnValue({ valid: true });
  mockValidateInviteCode.mockReturnValue({ valid: true });
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