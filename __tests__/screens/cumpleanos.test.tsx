import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import CumpleanosScreen from '@/app/(tabs)/cumpleanos';
import type { Contact } from '@/lib/types';
import type { UpcomingBirthday } from '@/lib/birthdays';

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

const mockAddContact = jest.fn();
const mockRemoveContact = jest.fn();
const mockUpdateContact = jest.fn();
jest.mock('@/lib/api', () => ({
  addContact: (...args: unknown[]) => mockAddContact(...args),
  fetchContacts: jest.fn(),
  removeContact: (...args: unknown[]) => mockRemoveContact(...args),
  updateContact: (...args: unknown[]) => mockUpdateContact(...args),
}));

const mockBirthdayLabel = jest.fn();
const mockUpcomingBirthdays = jest.fn();
jest.mock('@/lib/birthdays', () => ({
  birthdayLabel: (...args: unknown[]) => mockBirthdayLabel(...args),
  upcomingBirthdays: (...args: unknown[]) => mockUpcomingBirthdays(...args),
}));

const mockSyncBirthdays = jest.fn();
jest.mock('@/lib/calendar-sync', () => ({
  syncBirthdays: (...args: unknown[]) => mockSyncBirthdays(...args),
}));

const mockGetBirthdayChoice = jest.fn();
const mockScheduleBirthdays = jest.fn();
jest.mock('@/lib/notifications', () => ({
  getBirthdayChoice: (...args: unknown[]) => mockGetBirthdayChoice(...args),
  scheduleBirthdays: (...args: unknown[]) => mockScheduleBirthdays(...args),
}));

const mockToISODate = jest.fn();
jest.mock('@/lib/date', () => ({
  ...jest.requireActual('@/lib/date'),
  toISODate: (...args: unknown[]) => mockToISODate(...args),
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
const soonContact: Contact = {
  id: 'c1',
  casa_id: 'c1',
  user_id: 'u1',
  name: 'Ana',
  birth_date: '2018-03-14',
  relationship: 'Hermana',
  phone: null,
  created_at: '2026-01-01',
};
const restContact: Contact = {
  id: 'c2',
  casa_id: 'c1',
  user_id: 'u1',
  name: 'Leo',
  birth_date: '2015-11-02',
  relationship: 'Hijo',
  phone: '612345678',
  created_at: '2026-02-01',
};
const upcoming: UpcomingBirthday[] = [
  { contact: soonContact, date: new Date('2026-03-14'), daysUntil: 5, age: 8 },
];

function setup(contacts: Contact[] = [], currentCasa = casa) {
  mockUseAuth.mockReturnValue({ user });
  mockUseCasa.mockReturnValue({ currentCasa });
  mockUseRealtimeCollection.mockImplementation((_fetchFn: unknown, table: string) =>
    table === 'contacts'
      ? { data: contacts, loading: false, error: null, reload: jest.fn() }
      : { data: [], loading: false, error: null, reload: jest.fn() },
  );
  return render(<CumpleanosScreen />);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAddContact.mockResolvedValue(null);
  mockRemoveContact.mockResolvedValue(null);
  mockUpdateContact.mockResolvedValue(null);
  mockBirthdayLabel.mockReturnValue('en 5 días');
  mockUpcomingBirthdays.mockReturnValue([]);
  mockToISODate.mockReturnValue('2020-05-10');
  mockGetBirthdayChoice.mockResolvedValue('both');
  mockScheduleBirthdays.mockResolvedValue(undefined);
  mockValidateTitle.mockReturnValue({ valid: true });
  mockValidateDate.mockReturnValue({ valid: true });
  mockValidateOptionalText.mockReturnValue({ valid: true });
});

describe('CumpleanosScreen', () => {
  it('renderiza título y subtítulo', () => {
    const { getByText } = setup();
    expect(getByText('Cumpleaños')).toBeTruthy();
    expect(getByText('Nunca más olvides una fecha')).toBeTruthy();
  });

  it('muestra EmptyState sin cumpleaños próximos', () => {
    const { getByText } = setup();
    expect(getByText('Sin cumpleaños próximos')).toBeTruthy();
  });

  it('avisa sin contactos al pulsar sincronizar', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByText } = setup([]);

    fireEvent.press(getByText('Calendario'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Sin contactos',
      'Añade contactos primero para sincronizar sus cumpleaños.',
    );
    alertSpy.mockRestore();
  });

  it('sincroniza cumpleaños con calendario tras confirmar', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockSyncBirthdays.mockResolvedValue({ synced: 2, errors: 0 });
    const { getByText } = setup([soonContact, restContact]);

    fireEvent.press(getByText('Calendario'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Sincronizar cumpleaños',
      expect.stringContaining('para 2 contactos'),
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancelar', style: 'cancel' }),
        expect.objectContaining({ text: 'Sincronizar' }),
      ]),
    );

    const confirmButton = alertSpy.mock.calls[0][2]?.find(
      (btn) => btn.text === 'Sincronizar',
    );
    await act(async () => {
      await confirmButton?.onPress?.();
    });

    await waitFor(() => {
      expect(mockSyncBirthdays).toHaveBeenCalledWith([soonContact, restContact]);
      expect(alertSpy).toHaveBeenCalledWith(
        'Sincronización completada',
        '2 cumpleaños sincronizados con el calendario.',
      );
    });
    alertSpy.mockRestore();
  });

  it('muestra error si syncBirthdays falla (Android sin permiso)', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockSyncBirthdays.mockRejectedValue(new Error('Permissions error'));
    const { getByText } = setup([soonContact]);

    fireEvent.press(getByText('Calendario'));

    const confirmButton = alertSpy.mock.calls[0][2]?.find(
      (btn) => btn.text === 'Sincronizar',
    );
    await act(async () => {
      await confirmButton?.onPress?.();
    });

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Error',
        'No se pudo acceder al calendario. Revisa los permisos.',
      );
    });
    alertSpy.mockRestore();
  });

  it('muestra cumpleaños próximos', () => {
    mockUpcomingBirthdays.mockReturnValue(upcoming);
    const { getByText } = setup([soonContact]);

    expect(getByText('Ana')).toBeTruthy();
    expect(getByText('en 5 días')).toBeTruthy();
    expect(getByText(/14 de marzo/)).toBeTruthy();
    expect(getByText(/cumple 8/)).toBeTruthy();
  });

  it('muestra todos los contactos fuera del horizonte', () => {
    mockUpcomingBirthdays.mockReturnValue(upcoming);
    const { getByText } = setup([soonContact, restContact]);

    expect(getByText('Todos los contactos')).toBeTruthy();
    expect(getByText('Leo')).toBeTruthy();
    expect(getByText(/👪 Hijo/)).toBeTruthy();
    expect(getByText('📞 612345678')).toBeTruthy();
  });

  it('renderiza contacto con birth_date inválida sin crash', () => {
    const invalidContact: Contact = {
      ...restContact,
      id: 'c3',
      birth_date: 'basura',
    };
    const { getByText } = setup([invalidContact]);

    expect(getByText('Leo')).toBeTruthy();
    expect(getByText(/🎂 —/)).toBeTruthy();
  });

  it('abre modal y crea contacto nuevo', async () => {
    const { getByText, getByLabelText } = setup([]);

    fireEvent.press(getByText('add'));
    await waitFor(() => {
      expect(getByText('Nuevo contacto')).toBeTruthy();
    });

    const nameInput = getByLabelText('Nombre');
    fireEvent.changeText(nameInput, 'Sofía');
    fireEvent.press(getByText('Guardar'));

    await waitFor(() => {
      expect(mockAddContact).toHaveBeenCalledWith(
        expect.objectContaining({
          casa_id: 'c1',
          user_id: 'u1',
          name: 'Sofía',
          birth_date: '2020-05-10',
        }),
      );
    });
    await waitFor(() => {
      expect(mockScheduleBirthdays).toHaveBeenCalledWith([], 'both');
    });
  });

  it('edita contacto y guarda cambios', async () => {
    const { getByText, getByDisplayValue } = setup([restContact]);

    fireEvent.press(getByText('pencil-outline'));
    await waitFor(() => {
      expect(getByText('Editar contacto')).toBeTruthy();
    });

    const nameInput = getByDisplayValue('Leo');
    fireEvent.changeText(nameInput, 'León');
    fireEvent.press(getByText('Guardar cambios'));

    await waitFor(() => {
      expect(mockUpdateContact).toHaveBeenCalledWith(
        'c2',
        expect.objectContaining({ name: 'León', birth_date: '2020-05-10' }),
      );
    });
  });

  it('muestra Alert si addContact falla', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockAddContact.mockResolvedValue({
      message: 'Problema de conexión. Inténtalo de nuevo.',
    });
    const { getByText, getAllByDisplayValue } = setup([]);

    fireEvent.press(getByText('add'));
    await waitFor(() => expect(getByText('Nuevo contacto')).toBeTruthy());

    const [nameInput] = getAllByDisplayValue('');
    fireEvent.changeText(nameInput, 'Sofía');
    fireEvent.press(getByText('Guardar'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Error',
        'Problema de conexión. Inténtalo de nuevo.',
      );
    });
    alertSpy.mockRestore();
  });

  it('muestra aviso de crear casa cuando no hay casa', () => {
    mockUseCasa.mockReturnValue({ currentCasa: null, loading: false });
    const { getByText } = render(<CumpleanosScreen />);
    expect(getByText('Crea una casa primero')).toBeTruthy();
    expect(getByText('Ir a Ajustes')).toBeTruthy();
  });
});