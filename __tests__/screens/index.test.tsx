import { fireEvent, render, waitFor } from '@testing-library/react-native';

import HomeScreen from '@/app/(tabs)/index';
import type {
  Appointment,
  CasaMember,
  Contact,
  Expense,
  Profile,
  ShoppingList,
} from '@/lib/types';

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

jest.mock('@/lib/api', () => ({
  fetchAppointments: jest.fn(),
  fetchContacts: jest.fn(),
  fetchExpenses: jest.fn(),
  fetchShoppingLists: jest.fn(),
}));

const casa = { id: 'c1', name: 'Mi Hogar', invite_code: 'ABCD1234' };
const user = { id: 'u1', email: 'ana@casa.com' };
const profileCarlos: Profile = {
  id: 'u1',
  display_name: 'Carlos',
  created_at: '2026-01-01',
};
const ownerMember: CasaMember = {
  casa_id: 'c1',
  user_id: 'u1',
  role: 'owner',
  created_at: '2026-01-01',
};

function isoInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const appointment: Appointment = {
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
  created_at: '2026-01-01',
};

const expense: Expense = {
  id: 'e1',
  casa_id: 'c1',
  user_id: 'u1',
  category_id: 'cat1',
  title: 'Supermercado',
  amount: 45.5,
  spent_at: new Date().toISOString(),
  note: null,
  created_at: '2026-09-01T10:00:00',
};

const pendingList: ShoppingList = {
  id: 'l1',
  casa_id: 'c1',
  user_id: 'u1',
  title: 'Frutas',
  done: false,
  created_at: '2026-09-01',
};

const doneList: ShoppingList = {
  id: 'l2',
  casa_id: 'c1',
  user_id: 'u1',
  title: 'Farmacia',
  done: true,
  created_at: '2026-09-02',
};

const soonContact: Contact = {
  id: 'c1',
  casa_id: 'c1',
  user_id: 'u1',
  name: 'Ana',
  birth_date: isoInDays(5),
  relationship: 'Hermana',
  phone: null,
  created_at: '2026-01-01',
};

function setup(
  appointments: Appointment[] = [],
  expenses: Expense[] = [],
  lists: ShoppingList[] = [],
  contacts: Contact[] = [],
  currentCasa = casa,
  memberList: CasaMember[] = [ownerMember],
  profileMap: Record<string, Profile | null> = { u1: profileCarlos },
) {
  mockUseAuth.mockReturnValue({ user });
  mockUseCasa.mockReturnValue({ currentCasa, members: memberList, profiles: profileMap });
  mockUseRealtimeCollection.mockImplementation((_fetchFn: unknown, table: string) => {
    switch (table) {
      case 'appointments':
        return { data: appointments, loading: false, error: null, reload: jest.fn() };
      case 'expenses':
        return { data: expenses, loading: false, error: null, reload: jest.fn() };
      case 'shopping_lists':
        return { data: lists, loading: false, error: null, reload: jest.fn() };
      default:
        return { data: contacts, loading: false, error: null, reload: jest.fn() };
    }
  });
  return render(<HomeScreen />);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('HomeScreen', () => {
  it('renderiza nombre de casa y saludo', () => {
    const { getByText } = setup();
    expect(getByText('Mi Hogar')).toBeTruthy();
    expect(getByText(/Hola, Carlos/)).toBeTruthy();
  });

  it('muestra estados vacíos sin datos', () => {
    const { getByText } = setup();
    expect(getByText('No hay citas próximas.')).toBeTruthy();
    expect(getByText('Añade contactos para ver sus cumpleaños.')).toBeTruthy();
    expect(getByText('Miembros de la casa')).toBeTruthy();
  });

  it('muestra estadísticas de gastos y listas pendientes', () => {
    const { getByText } = setup([], [expense], [pendingList, pendingList, doneList]);
    expect(getByText('Gastos este mes')).toBeTruthy();
    expect(getByText('Listas pendientes')).toBeTruthy();
    expect(getByText('2')).toBeTruthy();
  });

  it('muestra próximas citas y miembros de la casa', () => {
    const memberAna: CasaMember = {
      casa_id: 'c1',
      user_id: 'u2',
      role: 'member',
      created_at: '2026-01-01',
    };
    const profileAna: Profile = {
      id: 'u2',
      display_name: 'Ana',
      created_at: '2026-01-01',
    };
    const { getByText } = setup(
      [appointment],
      [],
      [],
      [],
      casa,
      [ownerMember, memberAna],
      { u1: profileCarlos, u2: profileAna },
    );

    expect(getByText('Dentista')).toBeTruthy();
    expect(getByText(/2 miembros/)).toBeTruthy();
    expect(getByText('Ana')).toBeTruthy();
    expect(getByText('Administrador')).toBeTruthy();
  });

  it('muestra cumpleaños próximos', () => {
    const { getByText } = setup([], [], [], [soonContact]);
    expect(getByText(/Ana/)).toBeTruthy();
    expect(getByText('(cumple años)')).toBeTruthy();
  });
});