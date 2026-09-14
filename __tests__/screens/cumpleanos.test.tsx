import { fireEvent, render, waitFor } from '@testing-library/react-native';
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

const mockFromISODate = jest.fn();
const mockToISODate = jest.fn();
jest.mock('@/lib/date', () => ({
  fromISODate: (...args: unknown[]) => mockFromISODate(...args),
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
  mockFromISODate.mockReturnValue(new Date(2000, 0, 1));
  mockToISODate.mockReturnValue('2020-05-10');
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
});