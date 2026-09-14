import type { PropsWithChildren } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { AuthProvider, useAuth } from '@/context/auth-context';

const mockGetSession = jest.fn();
const mockOnAuthStateChange = jest.fn();
const mockSignInWithPassword = jest.fn();
const mockSignUp = jest.fn();
const mockSignOut = jest.fn();
const mockSignInWithOAuth = jest.fn();
const mockExchangeCodeForSession = jest.fn();
const mockSetSession = jest.fn();
const mockOpenAuthSession = jest.fn();
const mockIsWeb = jest.fn(() => false);

function defaultParseCallbackUrl(url: string): Record<string, string> {
  const raw = url.includes('#') ? (url.split('#')[1] ?? '') : (url.split('?')[1] ?? '');
  if (!raw) return {};
  const params = new URLSearchParams(raw);
  const result: Record<string, string> = {};
  const accessToken = params.get('access_token');
  if (accessToken) result.access_token = accessToken;
  const refreshToken = params.get('refresh_token');
  if (refreshToken) result.refresh_token = refreshToken;
  const code = params.get('code');
  if (code) result.code = code;
  return result;
}

const mockParseCallbackUrl = jest.fn(defaultParseCallbackUrl);

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      onAuthStateChange: (...args: unknown[]) => mockOnAuthStateChange(...args),
      signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
      signUp: (...args: unknown[]) => mockSignUp(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
      signInWithOAuth: (...args: unknown[]) => mockSignInWithOAuth(...args),
      exchangeCodeForSession: (...args: unknown[]) => mockExchangeCodeForSession(...args),
      setSession: (...args: unknown[]) => mockSetSession(...args),
    },
  },
}));

jest.mock('@/lib/oauth', () => ({
  buildRedirectUri: () => 'micasa://auth-callback',
  isWeb: () => mockIsWeb(),
  parseCallbackUrl: (url: string) => mockParseCallbackUrl(url),
}));

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: (...args: unknown[]) => mockOpenAuthSession(...args),
}));

const user = { id: 'u1', email: 'ana@casa.com' } as User;
const session = { user } as Session;

function wrapper({ children }: PropsWithChildren) {
  return <AuthProvider>{children}</AuthProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsWeb.mockReturnValue(false);
  mockParseCallbackUrl.mockImplementation(defaultParseCallbackUrl);
  mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
  mockOnAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: jest.fn() } },
  });
  mockSignInWithPassword.mockResolvedValue({ error: null });
  mockSignUp.mockResolvedValue({ error: null });
  mockSignOut.mockResolvedValue({ error: null });
  mockSignInWithOAuth.mockResolvedValue({
    data: { url: 'https://accounts.google.com/o/oauth2/auth?x=y' },
    error: null,
  });
  mockExchangeCodeForSession.mockResolvedValue({ error: null });
  mockSetSession.mockResolvedValue({ error: null });
  mockOpenAuthSession.mockResolvedValue({
    type: 'success',
    url: 'micasa://auth-callback#access_token=atoken&refresh_token=rtoken&expires_in=3600',
  });
});

describe('AuthProvider', () => {
  it('carga sin sesión', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull();
    expect(result.current.session).toBeNull();
  });

  it('restaura sesión guardada', async () => {
    mockGetSession.mockResolvedValue({ data: { session }, error: null });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user?.id).toBe('u1');
    expect(result.current.session).toEqual(session);
  });

  it('getSession rechazada deja loading false sin sesión', async () => {
    mockGetSession.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.session).toBeNull();
  });

  it('signIn devuelve null con credenciales válidas', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      const error = await result.current.signIn('ana@casa.com', '123456');
      expect(error).toBeNull();
    });

    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: 'ana@casa.com',
      password: '123456',
    });
  });

  it('signIn recorta el correo', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.signIn('  ana@casa.com  ', '123456');
    });

    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: 'ana@casa.com',
      password: '123456',
    });
  });

  it('signIn traduce errores', async () => {
    mockSignInWithPassword.mockResolvedValue({
      error: { message: 'Invalid login credentials' },
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      const error = await result.current.signIn('ana@casa.com', 'mala');
      expect(error).toEqual({ message: 'Correo o contraseña incorrectos.' });
    });
  });

  it('signUp envía nombre de display recortado', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.signUp('ana@casa.com', '123456', '  Ana García  ');
    });

    expect(mockSignUp).toHaveBeenCalledWith({
      email: 'ana@casa.com',
      password: '123456',
      options: {
        data: { display_name: 'Ana García' },
        emailRedirectTo: 'micasa://verify',
      },
    });
  });

  it('signUp devuelve error traducido', async () => {
    mockSignUp.mockResolvedValue({
      error: { message: 'already been registered' },
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      const error = await result.current.signUp('ana@casa.com', '123456', 'Ana');
      expect(error).toEqual({ message: 'Ya existe una cuenta con ese correo.' });
    });
  });

  it('signOut llama a supabase', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.signOut();
    });

    expect(mockSignOut).toHaveBeenCalled();
  });

  it('signInWithGoogle llama a signInWithOAuth y setSession con tokens', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      const error = await result.current.signInWithGoogle();
      expect(error).toBeNull();
    });

    expect(mockSignInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'micasa://auth-callback', skipBrowserRedirect: true },
    });
    expect(mockSetSession).toHaveBeenCalledWith({
      access_token: 'atoken',
      refresh_token: 'rtoken',
    });
  });

  it('signInWithGoogle traduce errores de signInWithOAuth', async () => {
    mockSignInWithOAuth.mockResolvedValue({
      data: null,
      error: { message: 'Provider not enabled' },
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      const error = await result.current.signInWithGoogle();
      expect(error).toEqual({
        message: 'Este método de acceso no está disponible en este momento.',
      });
    });
  });

  it('signInWithGoogle con código usa exchangeCodeForSession', async () => {
    mockOpenAuthSession.mockResolvedValue({
      type: 'success',
      url: 'micasa://auth-callback?code=auth_code_xyz&state=',
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.signInWithGoogle();
    });

    expect(mockExchangeCodeForSession).toHaveBeenCalledWith('auth_code_xyz');
  });

  it('signInWithGoogle cancela sin error', async () => {
    mockOpenAuthSession.mockResolvedValue({ type: 'cancel', url: '' });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      const error = await result.current.signInWithGoogle();
      expect(error).toBeNull();
    });

    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it('useAuth lanza error fuera del provider', () => {
    expect(() => renderHook(() => useAuth())).toThrow(
      'useAuth debe usarse dentro de <AuthProvider>',
    );
  });
});

describe('finishWebRedirect', () => {
  let replaceStateSpy: jest.Mock;
  let fakeLocation: { href: string; pathname: string; search: string; hash: string };
  const originalWindow = globalThis.window;

  function mockWindow() {
    fakeLocation = { href: '', pathname: '/', search: '', hash: '' };
    replaceStateSpy = jest.fn();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: {
        location: fakeLocation,
        history: { replaceState: replaceStateSpy },
      },
    });
  }

  function restoreWindow() {
    if (originalWindow === undefined) {
      delete (globalThis as Record<string, unknown>).window;
    } else {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        writable: true,
        value: originalWindow,
      });
    }
  }

  beforeEach(() => {
    mockIsWeb.mockReturnValue(true);
    mockWindow();
  });

  afterEach(() => {
    mockIsWeb.mockReturnValue(false);
    restoreWindow();
  });

  it('hash malformado no rompe el mount', async () => {
    mockParseCallbackUrl.mockImplementation(() => {
      throw new Error('url inválida');
    });
    fakeLocation.href = 'http://localhost/#%';
    fakeLocation.hash = '#%';

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.session).toBeNull();
  });

  it('applyCallback rechazada no causa unhandled rejection', async () => {
    mockExchangeCodeForSession.mockRejectedValue(new Error('exchange failed'));
    mockParseCallbackUrl.mockReturnValue({ code: 'auth_code_xyz' });
    fakeLocation.href = 'http://localhost/#code=auth_code_xyz';
    fakeLocation.hash = '#code=auth_code_xyz';

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.session).toBeNull();
  });

  it('access_token en hash limpia URL con pathname solo', async () => {
    mockParseCallbackUrl.mockReturnValue({
      access_token: 'atoken',
      refresh_token: 'rtoken',
    });
    fakeLocation.href = 'http://localhost/callback?extra=1#access_token=atoken&refresh_token=rtoken';
    fakeLocation.pathname = '/callback';
    fakeLocation.search = '?extra=1';
    fakeLocation.hash = '#access_token=atoken&refresh_token=rtoken';

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '/callback');
  });
});