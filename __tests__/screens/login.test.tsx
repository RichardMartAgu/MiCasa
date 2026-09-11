import { fireEvent, render, waitFor } from '@testing-library/react-native';

import LoginScreen from '@/app/login';

jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Redirect: () => null,
}));

const mockUseAuth = jest.fn();

jest.mock('@/context/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const signIn = jest.fn();

function setup(overrides: Partial<ReturnType<typeof mockUseAuth>> = {}) {
  mockUseAuth.mockReturnValue({
    session: null,
    user: null,
    loading: false,
    signIn,
    signUp: jest.fn(),
    signOut: jest.fn(),
    ...overrides,
  });
  return render(<LoginScreen />);
}

beforeEach(() => {
  jest.clearAllMocks();
  signIn.mockResolvedValue(null);
});

describe('LoginScreen', () => {
  it('muestra formulario de acceso', () => {
    const { getByText } = setup();
    expect(getByText('MiCasa')).toBeTruthy();
    expect(getByText('Entrar')).toBeTruthy();
    expect(getByText('Correo electrónico')).toBeTruthy();
    expect(getByText('Contraseña')).toBeTruthy();
  });

  it('no llama signIn con campos vacíos', async () => {
    const { getByText } = setup();

    fireEvent.press(getByText('Entrar'));

    await waitFor(() => {
      expect(getByText('El correo es obligatorio.')).toBeTruthy();
    });
    expect(signIn).not.toHaveBeenCalled();
  });

  it('llama signIn con credenciales válidas', async () => {
    const { getByText, getAllByDisplayValue } = setup();
    const [email, password] = getAllByDisplayValue('');

    fireEvent.changeText(email, 'ana@casa.com');
    fireEvent.changeText(password, '123456');
    fireEvent.press(getByText('Entrar'));

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith('ana@casa.com', '123456');
    });
  });

  it('muestra error de formulario si signIn falla', async () => {
    signIn.mockResolvedValue({ message: 'Correo o contraseña incorrectos.' });
    const { getByText, getAllByDisplayValue } = setup();
    const [email, password] = getAllByDisplayValue('');

    fireEvent.changeText(email, 'ana@casa.com');
    fireEvent.changeText(password, 'mala12');
    fireEvent.press(getByText('Entrar'));

    await waitFor(() => {
      expect(getByText('Correo o contraseña incorrectos.')).toBeTruthy();
    });
  });

  it('redirige si hay sesión', () => {
    const { queryByText } = setup({ session: { user: { id: 'u1' } } });
    expect(queryByText('Entrar')).toBeNull();
  });
});