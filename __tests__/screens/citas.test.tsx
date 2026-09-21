import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, Platform } from 'react-native';

import CitasScreen from '@/app/(tabs)/citas';
import type { Appointment } from '@/lib/types';

const mockDateTimePickerAndroidOpen = jest.fn();
jest.mock('@react-native-community/datetimepicker', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: function MockPicker() {
      return <View />;
    },
    DateTimePickerAndroid: {
      open: (...args: unknown[]) => mockDateTimePickerAndroidOpen(...args),
    },
  };
});

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => <Text>{name}</Text>,
  };
});

const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ navigate: mockNavigate }),
}));

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

const mockScheduleAppointment = jest.fn();
const mockCancelEntityKey = jest.fn();
jest.mock('@/lib/notifications', () => ({
  scheduleAppointment: (...args: unknown[]) => mockScheduleAppointment(...args),
  cancelEntityKey: (...args: unknown[]) => mockCancelEntityKey(...args),
}));

const mockAddAppointment = jest.fn();
const mockRemoveAppointment = jest.fn();
const mockUpdateAppointment = jest.fn();
const mockAddAppointmentKind = jest.fn();
const mockRemoveAppointmentKind = jest.fn();
const mockUpdateAppointmentKind = jest.fn();
jest.mock('@/lib/api', () => ({
  addAppointment: (...args: unknown[]) => mockAddAppointment(...args),
  addAppointmentKind: (...args: unknown[]) => mockAddAppointmentKind(...args),
  fetchAppointments: jest.fn(),
  fetchAppointmentKinds: jest.fn(),
  removeAppointment: (...args: unknown[]) => mockRemoveAppointment(...args),
  removeAppointmentKind: (...args: unknown[]) => mockRemoveAppointmentKind(...args),
  updateAppointment: (...args: unknown[]) => mockUpdateAppointment(...args),
  updateAppointmentKind: (...args: unknown[]) => mockUpdateAppointmentKind(...args),
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
  reminder_choice: 'none',
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
  reminder_choice: 'none',
  created_at: '2026-08-01',
};

const defaultKinds = [
  { id: 'k1', casa_id: 'c1', name: 'medico', icon: 'medkit-outline', sort_order: 0, created_at: '' },
  { id: 'k2', casa_id: 'c1', name: 'escuela', icon: 'school-outline', sort_order: 1, created_at: '' },
  { id: 'k4', casa_id: 'c1', name: 'personal', icon: 'person-outline', sort_order: 2, created_at: '' },
  { id: 'k5', casa_id: 'c1', name: 'otro', icon: 'ellipsis-horizontal-outline', sort_order: 3, created_at: '' },
];

function setup(appointments: Appointment[] = [], currentCasa = casa, kinds = defaultKinds) {
  mockUseAuth.mockReturnValue({ user });
  mockUseCasa.mockReturnValue({ currentCasa });
  mockUseRealtimeCollection.mockImplementation((_fetchFn: unknown, table: string) =>
    table === 'appointments'
      ? { data: appointments, loading: false, error: null, reload: jest.fn() }
      : table === 'appointment_kinds'
        ? { data: kinds, loading: false, error: null, reload: jest.fn() }
        : { data: [], loading: false, error: null, reload: jest.fn() },
  );
  return render(<CitasScreen />);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAddAppointment.mockResolvedValue({ error: null, data: { id: 'a1' } });
  mockRemoveAppointment.mockResolvedValue(null);
  mockUpdateAppointment.mockResolvedValue(null);
  mockAddAppointmentKind.mockResolvedValue(null);
  mockRemoveAppointmentKind.mockResolvedValue(null);
  mockUpdateAppointmentKind.mockResolvedValue(null);
  mockScheduleAppointment.mockResolvedValue(undefined);
  mockCancelEntityKey.mockResolvedValue(undefined);
  mockFormatDateTime.mockReturnValue('12 sep 2026, 10:00');
  mockValidateTitle.mockReturnValue({ valid: true });
  mockValidateDate.mockReturnValue({ valid: true });
  mockValidateOptionalText.mockReturnValue({ valid: true });
});

describe('CitasScreen', () => {
  it('renderiza título y subtítulo', () => {
    const { getByText } = setup();
    expect(getByText('Citas')).toBeTruthy();
    expect(getByText('Médico, escuela y más')).toBeTruthy();
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
      error: { message: 'Problema de conexión. Inténtalo de nuevo.' },
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
    await waitFor(() => {
      expect(mockCancelEntityKey).toHaveBeenCalledWith('appointment', 'a1');
    });
    alertSpy.mockRestore();
  });

  it('agenda recordatorio al crear cita', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    mockAddAppointment.mockResolvedValue({
      error: null,
      data: { id: 'a1', title: 'Vacunación' },
    });
    const { getByText, getByLabelText } = setup([]);

    fireEvent.press(getByText('add'));
    await waitFor(() => expect(getByText('Nueva cita')).toBeTruthy());

    fireEvent.press(getByText('Día antes + mismo día'));
    const titleInput = getByLabelText('Título');
    fireEvent.changeText(titleInput, 'Vacunación');
    fireEvent.press(getByLabelText(/^Cambiar fecha/));
    expect(mockDateTimePickerAndroidOpen).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'date', is24Hour: true }),
    );
    const openArgs = mockDateTimePickerAndroidOpen.mock.calls[0][0] as {
      onChange?: (event: { type: string }, date?: Date) => void;
    };
    act(() => {
      openArgs.onChange?.(
        { type: 'set' },
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      );
    });
    fireEvent.press(getByText('Guardar'));

    await waitFor(() => {
      expect(mockAddAppointment).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Vacunación',
          reminder_at: expect.any(String),
          reminder_choice: 'both',
        }),
      );
    });
    await waitFor(() => {
      expect(mockScheduleAppointment).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'a1', title: 'Vacunación' }),
        'both',
      );
    });
  });

  it('round-trip: editar cita day-before muestra chip Día antes, no both', async () => {
    const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const dayBeforeAppointment: Appointment = {
      ...upcomingAppointment,
      id: 'a3',
      title: 'Vacunación',
      reminder_choice: 'day-before',
      reminder_at: new Date(startsAt.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    };
    const { getByText, getByRole } = setup([dayBeforeAppointment]);

    fireEvent.press(getByText('pencil-outline'));
    await waitFor(() => expect(getByText('Editar cita')).toBeTruthy());

    expect(getByRole('radio', { name: 'Día antes' }).props.accessibilityState.checked).toBe(true);
    expect(
      getByRole('radio', { name: 'Día antes + mismo día' }).props.accessibilityState.checked,
    ).toBe(false);
  });

  it('abre gestor de tipos y añade tipo nuevo', async () => {
    const { getByText, getByLabelText } = setup();

    fireEvent.press(getByLabelText('Gestionar tipos de cita'));
    await waitFor(() =>
      expect(getByText('Añadir tipo', { includeHiddenElements: true })).toBeTruthy(),
    );

    const kindInput = getByLabelText('Nuevo tipo', { includeHiddenElements: true });
    fireEvent.changeText(kindInput, 'Reunión cole');
    fireEvent.press(getByText('Añadir tipo', { includeHiddenElements: true }));

    await waitFor(() => {
      expect(mockAddAppointmentKind).toHaveBeenCalledWith({
        casa_id: 'c1',
        name: 'Reunión cole',
      });
    });
  });

  it('rechaza tipo de cita con más de 40 caracteres', async () => {
    const { getByText, getByLabelText } = setup();

    fireEvent.press(getByLabelText('Gestionar tipos de cita'));
    await waitFor(() =>
      expect(getByText('Añadir tipo', { includeHiddenElements: true })).toBeTruthy(),
    );

    const kindInput = getByLabelText('Nuevo tipo', { includeHiddenElements: true });
    fireEvent.changeText(kindInput, 'x'.repeat(41));
    fireEvent.press(getByText('Añadir tipo', { includeHiddenElements: true }));

    expect(
      getByText('El nombre no puede superar 40 caracteres.', { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(mockAddAppointmentKind).not.toHaveBeenCalled();
  });

  it('edita tipo de cita', async () => {
    const { getByText, getByLabelText } = setup();

    fireEvent.press(getByLabelText('Gestionar tipos de cita'));
    await waitFor(() =>
      expect(getByText('Añadir tipo', { includeHiddenElements: true })).toBeTruthy(),
    );

    fireEvent.press(getByLabelText('Editar tipo medico', { includeHiddenElements: true }));
    const kindInput = getByLabelText('Editar nombre', { includeHiddenElements: true });
    fireEvent.changeText(kindInput, 'doctor');
    fireEvent.press(getByText('Guardar tipo', { includeHiddenElements: true }));

    await waitFor(() => {
      expect(mockUpdateAppointmentKind).toHaveBeenCalledWith('k1', { name: 'doctor' });
    });
  });

  it('elimina tipo de cita con confirmación', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByText, getByLabelText } = setup();

    fireEvent.press(getByLabelText('Gestionar tipos de cita'));
    await waitFor(() =>
      expect(getByText('Añadir tipo', { includeHiddenElements: true })).toBeTruthy(),
    );

    fireEvent.press(getByLabelText('Eliminar tipo personal', { includeHiddenElements: true }));
    const buttons = alertSpy.mock.calls[0][2] as
      | { text: string; onPress?: () => void }[]
      | undefined;
    buttons?.find((b) => b.text === 'Eliminar')?.onPress?.();

    await waitFor(() => {
      expect(mockRemoveAppointmentKind).toHaveBeenCalledWith('k4');
    });
    alertSpy.mockRestore();
  });

  it('usa tipo personalizado al crear cita', async () => {
    const { getByText, getByLabelText } = setup([], casa, [
      ...defaultKinds,
      { id: 'k6', casa_id: 'c1', name: 'Reunión cole', icon: 'calendar-outline', sort_order: 5, created_at: '' },
    ]);

    fireEvent.press(getByText('add'));
    await waitFor(() => expect(getByText('Nueva cita')).toBeTruthy());

    fireEvent.press(getByText('Reunión cole'));
    const titleInput = getByLabelText('Título');
    fireEvent.changeText(titleInput, 'Charla colegio');
    fireEvent.press(getByText('Guardar'));

    await waitFor(() => {
      expect(mockAddAppointment).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Charla colegio', kind: 'Reunión cole' }),
      );
    });
  });

  it('muestra aviso de crear casa cuando no hay casa', () => {
    mockUseCasa.mockReturnValue({ currentCasa: null, loading: false });
    const { getByText } = render(<CitasScreen />);
    expect(getByText('Crea una casa primero')).toBeTruthy();
    expect(getByText('Ir a Ajustes')).toBeTruthy();
  });
});