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

function setup(
  casas: Casa[] = [casa1, casa2],
  currentCasa = casa1,
  members: CasaMember[] = [ownerMember, member2],
  profiles: Record<string, Profile | null> = { u1: profileCarlos, u2: profileAna },
) {
  mockUseAuth.mockReturnValue({ user, signOut });
  mockUseCasa.mockReturnValue({
    casas,
    currentCasa,
    members,
    profiles,
    setCurrentCasa: mockSetCurrentCasa,
    createCasa: mockCreateCasa,
    joinCasa: mockJoinCasa,
  });
  return render(<AjustesScreen />);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSetCurrentCasa.mockResolvedValue(undefined);
  mockCreateCasa.mockResolvedValue(null);
  mockJoinCasa.mockResolvedValue(null);
  mockFormatInviteCode.mockReturnValue('ABCD1234');
  mockInitials.mockReturnValue('CA');
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
});