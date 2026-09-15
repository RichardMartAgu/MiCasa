import { fireEvent, render, waitFor } from '@testing-library/react-native';

import ResetPasswordScreen from '@/app/reset-password';

jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Redirect: () => null,
}));

const mockUseAuth = jest.fn();

jest.mock('@/context/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockSetSession = jest.fn();
const mockUpdateUser = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      setSession: (...args: unknown[]) => mockSetSession(...args),
      updateUser: (...args: unknown[]) => mockUpdateUser(...args),
    },
  },
}));

jest.mock('expo-linking', () => ({
  getInitialURL: jest.fn(async () => null),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
}));

import * as Linking from 'expo-linking';

const mockGetInitialURL = Linking.getInitialURL as jest.Mock;
const mockAddEventListener = Linking.addEventListener as jest.Mock;

const RECOVERY_URL =
  'micasa://reset-password#access_token=abc&refresh_token=xyz&type=recovery';

function setup(overrides: Partial<ReturnType<typeof mockUseAuth>> = {}) {
  mockUseAuth.mockReturnValue({ session: null, ...overrides });
  return render(<ResetPasswordScreen />);
}

function emitLinkingUrl(url: string) {
  const handler = mockAddEventListener.mock.calls[0]?.[1] as
    | ((event: { url: string }) => void)
    | undefined;
  handler?.({ url });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSetSession.mockResolvedValue({ error: null });
  mockUpdateUser.mockResolvedValue({ error: null });
  mockGetInitialURL.mockResolvedValue(null);
  mockAddEventListener.mockReturnValue({ remove: jest.fn() });
});

describe('ResetPasswordScreen', () => {
  it('muestra error si no hay enlace de recuperación', async () => {
    const { getByText, getAllByText } = setup();
    await waitFor(() => {
      expect(getByText('Enlace no válido o expirado.')).toBeTruthy();
    });
  });

  it('muestra formulario si el enlace trae tokens de recuperación', async () => {
    mockGetInitialURL.mockResolvedValue(RECOVERY_URL);
    const { getByText, getAllByText } = setup();
    await waitFor(() => {
      expect(getAllByText('Nueva contraseña').length).toBeGreaterThan(0);
    });
    expect(mockSetSession).toHaveBeenCalledWith({
      access_token: 'abc',
      refresh_token: 'xyz',
    });
  });

  it('procesa enlace recibido con el evento url', async () => {
    const { getByText, getAllByText } = setup();
    emitLinkingUrl(RECOVERY_URL);
    await waitFor(() => {
      expect(getAllByText('Nueva contraseña').length).toBeGreaterThan(0);
    });
  });

  it('llama updateUser con password válida', async () => {
    mockGetInitialURL.mockResolvedValue(RECOVERY_URL);
    const { getByText, getAllByText, getAllByDisplayValue } = setup();
    await waitFor(() => getAllByText('Nueva contraseña').length > 0);
    const [password, confirm] = getAllByDisplayValue('');
    fireEvent.changeText(password, 'NewPass123!');
    fireEvent.changeText(confirm, 'NewPass123!');
    fireEvent.press(getByText('Guardar contraseña'));
    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'NewPass123!' });
    });
  });

  it('muestra éxito tras guardar', async () => {
    mockGetInitialURL.mockResolvedValue(RECOVERY_URL);
    const { getByText, getAllByText, getAllByDisplayValue } = setup();
    await waitFor(() => getAllByText('Nueva contraseña').length > 0);
    const [password, confirm] = getAllByDisplayValue('');
    fireEvent.changeText(password, 'NewPass123!');
    fireEvent.changeText(confirm, 'NewPass123!');
    fireEvent.press(getByText('Guardar contraseña'));
    await waitFor(() => {
      expect(getByText('Contraseña actualizada')).toBeTruthy();
    });
  });

  it('no redirige con sesión de recuperación activa', async () => {
    mockGetInitialURL.mockResolvedValue(RECOVERY_URL);
    const { getAllByText } = setup({ session: { user: { id: 'u1' } } });
    await waitFor(() => {
      expect(getAllByText('Nueva contraseña').length).toBeGreaterThan(0);
    });
  });
});