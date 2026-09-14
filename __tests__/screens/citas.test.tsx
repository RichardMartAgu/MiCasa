import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import CitasScreen from '@/app/(tabs)/citas';
import type { Appointment } from '@/lib/types';

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

const mockAddAppointment = jest.fn();
const mockRemoveAppointment = jest.fn();
const mockUpdateAppointment = jest.fn();
jest.mock('@/lib/api', () => ({
  addAppointment: (...args: unknown[]) => mockAddAppointment(...args),
  fetchAppointments: jest.fn(),
  removeAppointment: (...args: unknown[]) => mockRemoveAppointment(...args),
  updateAppointment: (...args: unknown[]) => mockUpdateAppointment(...args),
}));

const mockFormatDateTime = jest.fn();
jest.mock('@/lib/date', () => ({
  formatDateTime: (...args: unknown[]) => mockFormatDateTime(...args),
}));

const mockValidateTitle = jest.fn();
const mockValidateDate = jest.fn();
const mockValidateOptionalText = jest.fn();
jest.mock('@/lib/validation', () => ({
  validateDate: (...args: unknown[]) => mockValidateDate(...args),
  validateOptionalText: (...args: unknown[]) => mockValidateOptionalText(...args),
  validateTitle: (...args: unknown[]) => mockValidateTitle(...args),
}));

const casa = { id: 'c1', name: 'Mi Hogar', invite_code: 'ABCD1234' };
const user = { id: 'u1' };
const upcomingAppointment: Appointment = {
  id: 'a1',
  casa_id: 'c1',
  user_id: 'u1',
  title: 'Dentista',
  description: null,
  person: 'Leo',
  location: 'Clínica',
  kind: 'medico',
  starts_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  reminder_at: null,
  created_at: '2026-09-01',
};
const pastAppointment: Appointment = {
  id: 'a2',
  casa_id: 'c1',
  user_id: 'u1',
  title: 'Revisión',
  description: null,
  person: null,
  location: null,
  kind: 'personal',
  starts_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  reminder_at: null,
  created_at: '2026-08-01',
};

function setup(appointments: Appointment[] = [], currentCasa = casa) {
  mockUseAuth.mockReturnValue({ user });
  mockUseCasa.mockReturnValue({ currentCasa });
  mockUseRealtimeCollection.mockImplementation((_fetchFn: unknown, table: string) =>
    table === 'appointments'
      ? { data: appointments, loading: false, error: null, reload: jest.fn() }
      : { data: [], loading: false, error: null, reload: jest.fn() },
  );
  return render(<CitasScreen />);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAddAppointment.mockResolvedValue(null);
  mockRemoveAppointment.mockResolvedValue(null);
  mockUpdateAppointment.mockResolvedValue(null);
  mockFormatDateTime.mockReturnValue('12 sep 2026, 10:00');
  mockValidateTitle.mockReturnValue({ valid: true });
  mockValidateDate.mockReturnValue({ valid: true });
  mockValidateOptionalText.mockReturnValue({ valid: true });
});

describe('CitasScreen', () => {
  it('renderiza título y subtítulo', () => {
    const { getByText } = setup();
    expect(getByText('Citas')).toBeTruthy();
    expect(getByText('Médico, escuela, mascotas y más')).toBeTruthy();
  });

  it('muestra EmptyState sin citas próximas', () => {
    const { getByText } = setup();
    expect(getByText('Sin citas próximas')).toBeTruthy();
  });

  it('muestra citas próximas con fecha formateada', () => {
    const { getByText } = setup([upcomingAppointment]);
    expect(getByText('Dentista')).toBeTruthy();
    expect(getByText('12 sep 2026, 10:00')).toBeTruthy();
    expect(getByText('👤 Leo')).toBeTruthy();
    expect(getByText('📍 Clínica')).toBeTruthy();
  });

  it('abre modal y crea cita nueva', async () => {
    const { getByText, getByLabelText } = setup([]);

    fireEvent.press(getByText('add'));
    await waitFor(() => {
      expect(getByText('Nueva cita')).toBeTruthy();
    });

    const titleInput = getByLabelText('Título');
    fireEvent.changeText(titleInput, 'Vacunación');
    fireEvent.press(getByText('Guardar'));

    await waitFor(() => {
      expect(mockAddAppointment).toHaveBeenCalledWith(
        expect.objectContaining({
          casa_id: 'c1',
          user_id: 'u1',
          title: 'Vacunación',
          kind: 'medico',
        }),
      );
    });
  });

  it('edita cita y guarda cambios', async () => {
    const { getByText, getByDisplayValue } = setup([upcomingAppointment]);

    fireEvent.press(getByText('pencil-outline'));
    await waitFor(() => {
      expect(getByText('Editar cita')).toBeTruthy();
    });

    const titleInput = getByDisplayValue('Dentista');
    fireEvent.changeText(titleInput, 'Dentista infantil');
    fireEvent.press(getByText('Guardar cambios'));

    await waitFor(() => {
      expect(mockUpdateAppointment).toHaveBeenCalledWith(
        'a1',
        expect.objectContaining({ title: 'Dentista infantil' }),
      );
    });
  });

  it('muestra errores de validación al guardar', async () => {
    mockValidateTitle.mockReturnValue({
      valid: false,
      message: 'El título es obligatorio.',
    });
    const { getByText } = setup([]);

    fireEvent.press(getByText('add'));
    await waitFor(() => expect(getByText('Nueva cita')).toBeTruthy());

    fireEvent.press(getByText('Guardar'));

    await waitFor(() => {
      expect(getByText('El título es obligatorio.')).toBeTruthy();
    });
    expect(mockAddAppointment).not.toHaveBeenCalled();
  });

  it('muestra Alert si addAppointment falla', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockAddAppointment.mockResolvedValue({
      message: 'Problema de conexión. Inténtalo de nuevo.',
    });
    const { getByText, getAllByDisplayValue } = setup([]);

    fireEvent.press(getByText('add'));
    await waitFor(() => expect(getByText('Nueva cita')).toBeTruthy());

    const [titleInput] = getAllByDisplayValue('');
    fireEvent.changeText(titleInput, 'Vacunación');
    fireEvent.press(getByText('Guardar'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Error',
        'Problema de conexión. Inténtalo de nuevo.',
      );
    });
    alertSpy.mockRestore();
  });

  it('elimina cita con confirmación', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByText } = setup([upcomingAppointment]);

    fireEvent.press(getByText('trash-outline'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Eliminar cita',
      expect.any(String),
      expect.any(Array),
    );
    const buttons = alertSpy.mock.calls[0][2] as
      | { text: string; onPress?: () => void }[]
      | undefined;
    const deleteButton = buttons?.find((b) => b.text === 'Eliminar');
    deleteButton?.onPress?.();

    await waitFor(() => {
      expect(mockRemoveAppointment).toHaveBeenCalledWith('a1');
    });
    alertSpy.mockRestore();
  });
});