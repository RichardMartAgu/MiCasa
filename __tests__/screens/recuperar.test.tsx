import { fireEvent, render, waitFor } from '@testing-library/react-native';

import RecuperarScreen from '@/app/recuperar';

jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Redirect: () => null,
}));

const mockUseAuth = jest.fn();

jest.mock('@/context/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockResetPasswordForEmail = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { resetPasswordForEmail: (...args: unknown[]) => mockResetPasswordForEmail(...args) } },
}));

function setup(overrides: Partial<ReturnType<typeof mockUseAuth>> = {}) {
  mockUseAuth.mockReturnValue({ session: null, ...overrides });
  return render(<RecuperarScreen />);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockResetPasswordForEmail.mockResolvedValue({ error: null });
});

describe('RecuperarScreen', () => {
  it('muestra formulario de recuperación', () => {
    const { getByText } = setup();
    expect(getByText('Recuperar contraseña')).toBeTruthy();
    expect(getByText('Enviar enlace')).toBeTruthy();
    expect(getByText('Correo electrónico')).toBeTruthy();
  });

  it('no llama resetPasswordForEmail con email vacío', async () => {
    const { getByText } = setup();
    fireEvent.press(getByText('Enviar enlace'));
    await waitFor(() => {
      expect(getByText('El correo es obligatorio.')).toBeTruthy();
    });
    expect(mockResetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('llama resetPasswordForEmail con email válido', async () => {
    const { getByText, getByDisplayValue } = setup();
    const input = getByDisplayValue('');
    fireEvent.changeText(input, 'test@casa.com');
    fireEvent.press(getByText('Enviar enlace'));
    await waitFor(() => {
      expect(mockResetPasswordForEmail.mock.calls[0][0]).toBe('test@casa.com');
    });
  });

  it('muestra mensaje de éxito tras enviar', async () => {
    const { getByText, getByDisplayValue } = setup();
    fireEvent.changeText(getByDisplayValue(''), 'test@casa.com');
    fireEvent.press(getByText('Enviar enlace'));
    await waitFor(() => {
      expect(getByText('Revisa tu correo electrónico. Enviamos un enlace para restablecer tu contraseña.')).toBeTruthy();
    });
  });

  it('muestra error si resetPasswordForEmail falla', async () => {
    mockResetPasswordForEmail.mockResolvedValue({ error: { message: 'Email not found' } });
    const { getByText, getByDisplayValue } = setup();
    fireEvent.changeText(getByDisplayValue(''), 'bad@casa.com');
    fireEvent.press(getByText('Enviar enlace'));
    await waitFor(() => {
      expect(getByText('Error desconocido. Inténtalo de nuevo.')).toBeTruthy();
    });
  });

  it('redirige si hay sesión', () => {
    const { queryByText } = setup({ session: { user: { id: 'u1' } } });
    expect(queryByText('Enviar enlace')).toBeNull();
  });
});
