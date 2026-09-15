import { fireEvent, render, waitFor } from '@testing-library/react-native';

import RegisterScreen from '@/app/register';

jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Redirect: () => null,
}));

const mockUseAuth = jest.fn();

jest.mock('@/context/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const signUp = jest.fn();

function setup(overrides: Partial<ReturnType<typeof mockUseAuth>> = {}) {
  mockUseAuth.mockReturnValue({
    session: null,
    user: null,
    loading: false,
    signIn: jest.fn(),
    signUp,
    signOut: jest.fn(),
    ...overrides,
  });
  return render(<RegisterScreen />);
}

beforeEach(() => {
  jest.clearAllMocks();
  signUp.mockResolvedValue(null);
});

describe('RegisterScreen', () => {
  it('muestra formulario de registro', () => {
    const { getByText, getByRole } = setup();
    expect(getByRole('button', { name: 'Crear cuenta' })).toBeTruthy();
    expect(getByText('Tu nombre')).toBeTruthy();
    expect(getByText('Correo electrónico')).toBeTruthy();
    expect(getByText('Contraseña')).toBeTruthy();
    expect(getByRole('button', { name: 'Crear cuenta' })).toBeTruthy();
  });

  it('no llama signUp con campos vacíos', async () => {
    const { getByText, getByRole } = setup();

    fireEvent.press(getByRole('button', { name: 'Crear cuenta' }));

    await waitFor(() => {
      expect(getByText('El nombre es obligatorio.')).toBeTruthy();
    });
    expect(signUp).not.toHaveBeenCalled();
  });

  it('llama signUp con datos válidos', async () => {
    const { getByText, getByRole, getAllByDisplayValue } = setup();
    const [name, email, password] = getAllByDisplayValue('');

    fireEvent.changeText(name, 'Ana García');
    fireEvent.changeText(email, 'ana@casa.com');
    fireEvent.changeText(password, '123456');
    fireEvent.press(getByRole('button', { name: 'Crear cuenta' }));

    await waitFor(() => {
      expect(signUp).toHaveBeenCalledWith('ana@casa.com', '123456', 'Ana García');
    });
  });

  it('muestra confirmación tras éxito', async () => {
    const { getByText, getByRole, getAllByDisplayValue } = setup();
    const [name, email, password] = getAllByDisplayValue('');

    fireEvent.changeText(name, 'Ana');
    fireEvent.changeText(email, 'ana@casa.com');
    fireEvent.changeText(password, '123456');
    fireEvent.press(getByRole('button', { name: 'Crear cuenta' }));

    await waitFor(() => {
      expect(getByText(/Revisa tu correo para confirmar/)).toBeTruthy();
    });
  });

  it('muestra error de formulario si signUp falla', async () => {
    signUp.mockResolvedValue({ message: 'Ya existe una cuenta con ese correo.' });
    const { getByText, getByRole, getAllByDisplayValue } = setup();
    const [name, email, password] = getAllByDisplayValue('');

    fireEvent.changeText(name, 'Ana');
    fireEvent.changeText(email, 'ana@casa.com');
    fireEvent.changeText(password, '123456');
    fireEvent.press(getByRole('button', { name: 'Crear cuenta' }));

    await waitFor(() => {
      expect(getByText('Ya existe una cuenta con ese correo.')).toBeTruthy();
    });
  });
});