import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { CasaProvider, useCasa } from '@/context/casa-context';

const mockGetUser = jest.fn();
const mockFrom = jest.fn();
const mockRpc = jest.fn();
const mockGetItem = jest.fn();
const mockSetItem = jest.fn();
const mockChannel = jest.fn();
const mockRemoveChannel = jest.fn();
const mockUseAuth = jest.fn();

let realtimeHandler: (() => void) | null = null;
let lastRealtimeConfig: unknown = null;
let lastChannel: { on: jest.Mock; subscribe: jest.Mock } | null = null;

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
    channel: (...args: unknown[]) => mockChannel(...args),
    removeChannel: (...args: unknown[]) => mockRemoveChannel(...args),
  },
}));

jest.mock('@/context/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: (...args: unknown[]) => mockGetItem(...args),
    setItem: (...args: unknown[]) => mockSetItem(...args),
  },
}));

const user = { id: 'u1' };
const casa = { id: 'c1', name: 'Mi Hogar', invite_code: 'ABCD1234' };
const member = { user_id: 'u1', role: 'owner' };
const profile = { id: 'u1', display_name: 'Ana' };
const authDefaults: {
  loading: boolean;
  user: { id: string } | null;
  session: null;
  signIn: jest.Mock;
  signUp: jest.Mock;
  signInWithGoogle: jest.Mock;
  signOut: jest.Mock;
} = {
  loading: false,
  user: { id: 'u1' },
  session: null,
  signIn: jest.fn(),
  signUp: jest.fn(),
  signInWithGoogle: jest.fn(),
  signOut: jest.fn(),
};

function queryChain(result: Record<string, unknown>) {
  const query: Record<string, unknown> & { then: (onfulfilled: (value: unknown) => unknown) => unknown } = {
    then: (resolve: (value: unknown) => unknown) => resolve(result),
  };
  for (const method of ['select', 'eq', 'order', 'insert', 'update', 'delete', 'in']) {
    query[method] = jest.fn(() => query);
  }
  query.single = jest.fn(() => {
    const data = Array.isArray(result.data) ? (result.data[0] ?? null) : result.data;
    const singleResult = { ...result, data };
    return { ...query, then: (resolve: (value: unknown) => unknown) => resolve(singleResult) };
  });
  return query;
}

function wrapper({ children }: PropsWithChildren) {
  return <CasaProvider>{children}</CasaProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  realtimeHandler = null;
  mockUseAuth.mockReturnValue({
    loading: false,
    user: { id: 'u1' },
    session: null,
    signIn: jest.fn(),
    signUp: jest.fn(),
    signInWithGoogle: jest.fn(),
    signOut: jest.fn(),
  });
  mockGetUser.mockResolvedValue({ data: { user } });
  mockGetItem.mockResolvedValue(null);
  mockSetItem.mockResolvedValue(undefined);
  mockFrom.mockReturnValue(queryChain({ data: [], error: null }));
  mockRpc.mockResolvedValue({ data: { ...casa }, error: null });
  mockChannel.mockImplementation(() => {
    lastChannel = {
      on: jest.fn((_event: string, _config: unknown, callback: () => void) => {
        realtimeHandler = callback;
        lastRealtimeConfig = _config;
        return lastChannel;
      }),
      subscribe: jest.fn(() => lastChannel),
    };
    return lastChannel;
  });
});

describe('CasaProvider', () => {
  it('carga casas del usuario', async () => {
    mockFrom.mockReturnValue(queryChain({ data: [casa], error: null }));
    const { result } = renderHook(() => useCasa(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.casas).toEqual([casa]);
    expect(result.current.currentCasa).toEqual(casa);
  });

  it('sin usuario limpia estado', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const { result } = renderHook(() => useCasa(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.casas).toEqual([]);
    expect(result.current.currentCasa).toBeNull();
  });

  it('restaura casa guardada en AsyncStorage', async () => {
    mockGetItem.mockResolvedValue('c2');
    mockFrom.mockReturnValue(
      queryChain({
        data: [
          { id: 'c1', name: 'Casa 1', invite_code: 'AA111111' },
          { id: 'c2', name: 'Casa 2', invite_code: 'BB222222' },
        ],
        error: null,
      }),
    );
    const { result } = renderHook(() => useCasa(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.currentCasa?.id).toBe('c2');
  });

  it('setCurrentCasa persiste selección', async () => {
    const { result } = renderHook(() => useCasa(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setCurrentCasa(casa as never);
    });

    expect(mockSetItem).toHaveBeenCalledWith('micasa.current_casa_id', 'c1');
    expect(result.current.currentCasa).toEqual(casa);
  });

  it('createCasa inserta y refresca', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'casa_members') {
        return queryChain({ data: [member], error: null });
      }
      if (table === 'profiles') {
        return queryChain({ data: [profile], error: null });
      }
      return queryChain({ data: [casa], error: null });
    });
    const { result } = renderHook(() => useCasa(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.currentCasa).toEqual(casa);

    await act(async () => {
      const error = await result.current.createCasa('Mi Hogar');
      expect(error).toBeNull();
    });

    expect(mockGetUser).toHaveBeenCalled();
    expect(mockSetItem).toHaveBeenCalledWith('micasa.current_casa_id', 'c1');
    expect(result.current.currentCasa).toEqual(casa);
  });

  it('createCasa devuelve error de sesión sin usuario', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const { result } = renderHook(() => useCasa(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      const error = await result.current.createCasa('Mi Hogar');
      expect(error).toEqual({ message: 'Sesión no válida.' });
    });
  });

  it('joinCasa usa RPC con código en mayúsculas', async () => {
    const { result } = renderHook(() => useCasa(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      const error = await result.current.joinCasa('abcdef0123456789');
      expect(error).toBeNull();
    });

    expect(mockRpc).toHaveBeenCalledWith('join_casa', { code: 'ABCDEF0123456789' });
  });

  it('joinCasa devuelve error si la casa no existe', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useCasa(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      const error = await result.current.joinCasa('ABCDEF0123456789');
      expect(error).toEqual({ message: 'No existe ninguna casa con ese código.' });
    });
  });

  it('joinCasa traduce errores RPC', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'Debes iniciar sesión' } });
    const { result } = renderHook(() => useCasa(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      const error = await result.current.joinCasa('ABCDEF0123456789');
      expect(error).toEqual({ message: 'Debes iniciar sesión.' });
    });
  });

  it('carga miembros y perfiles de la casa actual', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'casas') {
        return queryChain({ data: [casa], error: null });
      }
      if (table === 'casa_members') {
        return queryChain({ data: [member], error: null });
      }
      if (table === 'profiles') {
        return queryChain({ data: [profile], error: null });
      }
      return queryChain({ data: [], error: null });
    });

    const { result } = renderHook(() => useCasa(), { wrapper });
    await waitFor(() => expect(result.current.casas).toEqual([casa]));
    await waitFor(() => expect(result.current.members).toEqual([member]));
    expect(result.current.profiles).toEqual({ u1: profile });
  });

  it('refreshMembers recarga miembros de la casa actual', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'casas') {
        return queryChain({ data: [casa], error: null });
      }
      if (table === 'casa_members') {
        return queryChain({ data: [member], error: null });
      }
      if (table === 'profiles') {
        return queryChain({ data: [profile], error: null });
      }
      return queryChain({ data: [], error: null });
    });

    const { result } = renderHook(() => useCasa(), { wrapper });
    await waitFor(() => expect(result.current.members).toEqual([member]));

    await act(async () => {
      await result.current.refreshMembers();
    });

    expect(result.current.members).toEqual([member]);
    expect(result.current.profiles).toEqual({ u1: profile });
  });

  it('renameCasa actualiza el nombre y refresca', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'casas') {
        return queryChain({ data: [{ ...casa, name: 'Hogar renovado' }], error: null });
      }
      return queryChain({ data: [], error: null });
    });
    const { result } = renderHook(() => useCasa(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      const error = await result.current.renameCasa('c1', 'Hogar renovado');
      expect(error).toBeNull();
    });

    expect(result.current.casas[0]?.name).toBe('Hogar renovado');
  });

  it('deleteCasa borra y refresca a null si era la actual', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'casas') {
        return queryChain({ data: [], error: null });
      }
      return queryChain({ data: [], error: null });
    });
    const { result } = renderHook(() => useCasa(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      const error = await result.current.deleteCasa('c1');
      expect(error).toBeNull();
    });

    expect(result.current.casas).toEqual([]);
    expect(result.current.currentCasa).toBeNull();
  });

  it('useCasa lanza error fuera del provider', () => {
    expect(() => renderHook(() => useCasa())).toThrow(
      'useCasa debe usarse dentro de <CasaProvider>',
    );
  });

it('suscribe a realtime de casas y refresca al recibir cambios', async () => {
    mockFrom.mockReturnValue(queryChain({ data: [casa], error: null }));
    const { result } = renderHook(() => useCasa(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockChannel).toHaveBeenCalledTimes(1);
    expect(mockChannel).toHaveBeenCalledWith(expect.stringMatching(/^realtime-casas-/));
    expect(lastRealtimeConfig).toEqual({ event: '*', schema: 'public', table: 'casas' });
    expect(realtimeHandler).not.toBeNull();

    mockFrom.mockReturnValue(
      queryChain({ data: [{ ...casa, name: 'Renombrada en vivo' }], error: null }),
    );
    await act(async () => {
      realtimeHandler?.();
    });

    await waitFor(() => expect(result.current.casas[0]?.name).toBe('Renombrada en vivo'));
  });

  it('sin usuario no suscribe a realtime', async () => {
    mockUseAuth.mockReturnValue({ ...authDefaults, user: null });
    renderHook(() => useCasa(), { wrapper });
    await waitFor(() => expect(mockChannel).toHaveBeenCalledTimes(0));
  });

  it('desuscribe realtime al desmontar', async () => {
    mockFrom.mockReturnValue(queryChain({ data: [casa], error: null }));
    const { unmount } = renderHook(() => useCasa(), { wrapper });
    await waitFor(() => expect(mockChannel).toHaveBeenCalledTimes(1));

    unmount();
    expect(mockRemoveChannel).toHaveBeenCalledWith(lastChannel);
  });

  it('no carga casas mientras la autenticación está cargando', async () => {
    mockUseAuth.mockReturnValue({ ...authDefaults, loading: true });
    const { result } = renderHook(() => useCasa(), { wrapper });

    await act(async () => {});

    expect(result.current.loading).toBe(true);
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('recarga casas cuando cambia el usuario', async () => {
    type AuthProps = { auth: typeof authDefaults };
    const { result, rerender } = renderHook<ReturnType<typeof useCasa>, AuthProps>(
      () => useCasa(),
      { wrapper },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockFrom).toHaveBeenCalledWith('casas');

    mockUseAuth.mockReturnValue({ ...authDefaults, user: { id: 'u2' } });
    rerender({ auth: authDefaults });

    await waitFor(() => {
      const casaCalls = mockFrom.mock.calls.filter((call) => call[0] === 'casas');
      expect(casaCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('al restaurar sesión desde authLoading true carga casas del usuario', async () => {
    type AuthProps = { auth: typeof authDefaults };
    mockUseAuth.mockReturnValue({ ...authDefaults, loading: true, user: null });
    const { result, rerender } = renderHook<ReturnType<typeof useCasa>, AuthProps>(
      () => useCasa(),
      { wrapper },
    );

    await act(async () => {});
    expect(result.current.loading).toBe(true);
    expect(mockFrom).not.toHaveBeenCalledWith('casas');

    mockFrom.mockReturnValue(queryChain({ data: [casa], error: null }));
    mockUseAuth.mockReturnValue({ ...authDefaults, user: { id: 'u1' } });
    rerender({ auth: { ...authDefaults, user: { id: 'u1' } } });

    await waitFor(() => expect(result.current.casas).toEqual([casa]));
    expect(result.current.currentCasa).toEqual(casa);
  });

  it('al cerrar sesión limpia casas y casa actual', async () => {
    type AuthProps = { auth: typeof authDefaults };
    mockFrom.mockReturnValue(queryChain({ data: [casa], error: null }));
    const { result, rerender } = renderHook<ReturnType<typeof useCasa>, AuthProps>(
      () => useCasa(),
      { wrapper },
    );
    await waitFor(() => expect(result.current.casas).toEqual([casa]));

    mockUseAuth.mockReturnValue({ ...authDefaults, user: null });
    mockGetUser.mockResolvedValue({ data: { user: null } });
    rerender({ auth: { ...authDefaults, user: null } });

    await waitFor(() => expect(result.current.casas).toEqual([]));
    expect(result.current.currentCasa).toBeNull();
  });
});
