import { act, renderHook, waitFor } from '@testing-library/react-native';

import {
  safeRealtimeFilter,
  useRealtimeCollection,
} from '@/hooks/use-realtime-collection';

const mockChannel = jest.fn();
const mockRemoveChannel = jest.fn();
const mockOn = jest.fn();
const mockSubscribe = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    channel: (...args: unknown[]) => mockChannel(...args),
    removeChannel: (...args: unknown[]) => mockRemoveChannel(...args),
  },
}));

function stubChannel() {
  mockChannel.mockReturnValue({
    on: mockOn.mockReturnThis(),
    subscribe: mockSubscribe,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  stubChannel();
});

describe('safeRealtimeFilter', () => {
  it('acepta filtros PostgREST simples', () => {
    expect(safeRealtimeFilter('list_id=eq.abc-123', 'casa-1')).toBe('list_id=eq.abc-123');
    expect(safeRealtimeFilter('amount=gt.100', 'casa-1')).toBe('amount=gt.100');
  });

  it('rechaza filtros con payload sospechoso y cae al filtro casa', () => {
    expect(safeRealtimeFilter('casa_id=eq.otra-casa', 'casa-1')).toBe('casa_id=eq.casa-1');
    expect(safeRealtimeFilter('x=eq.1; drop table users', 'casa-1')).toBe('casa_id=eq.casa-1');
    expect(safeRealtimeFilter('casa_id=eq.', 'casa-1')).toBe('casa_id=eq.casa-1');
  });

  it('usa filtro casa si no se pasa filter', () => {
    expect(safeRealtimeFilter(undefined, 'casa-1')).toBe('casa_id=eq.casa-1');
  });

  it('usa columna de membresía personalizada en fallback', () => {
    expect(safeRealtimeFilter(undefined, 'lista-1', 'list_id')).toBe('list_id=eq.lista-1');
    expect(safeRealtimeFilter('list_id=eq.lista-2', 'lista-1', 'list_id')).toBe(
      'list_id=eq.lista-1',
    );
  });
});

describe('useRealtimeCollection', () => {
  it('carga datos iniciales y deja de cargar', async () => {
    const fetchFn = jest.fn().mockResolvedValue([{ id: '1' }]);
    const { result } = renderHook(() =>
      useRealtimeCollection(fetchFn, 'expenses', 'casa-1'),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([{ id: '1' }]);
    expect(result.current.error).toBeNull();
    expect(mockChannel).toHaveBeenCalledWith(
      expect.stringContaining('expenses'),
    );
  });

  it('no ejecuta fetch ni suscripción sin casa', () => {
    const fetchFn = jest.fn();
    renderHook(() => useRealtimeCollection(fetchFn, 'expenses', null));

    expect(fetchFn).not.toHaveBeenCalled();
    expect(mockChannel).not.toHaveBeenCalled();
  });

  it('usa filtro personalizado si se pasa', async () => {
    const fetchFn = jest.fn().mockResolvedValue([]);
    renderHook(() => useRealtimeCollection(fetchFn, 'items', 'casa-1', 'list_id=eq.1'));

    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    expect(mockChannel).toHaveBeenCalledWith(
      expect.stringContaining('list_id=eq.1'),
    );
    expect(mockOn).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({ table: 'items', filter: 'list_id=eq.1' }),
      expect.any(Function),
    );
  });

  it('ignora filtro inválido y usa filtro casa', async () => {
    const fetchFn = jest.fn().mockResolvedValue([]);
    renderHook(() =>
      useRealtimeCollection(fetchFn, 'items', 'casa-1', 'casa_id=eq.otra-casa'),
    );

    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    expect(mockOn).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({ table: 'items', filter: 'casa_id=eq.casa-1' }),
      expect.any(Function),
    );
  });

  it('captura error de fetch inicial y limpia loading', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() =>
      useRealtimeCollection(fetchFn, 'expenses', 'casa-1'),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('boom');
    expect(result.current.data).toEqual([]);
  });

  it('reload vuelve a cargar datos', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce([{ id: '1' }])
      .mockResolvedValueOnce([{ id: '1' }, { id: '2' }]);
    const { result } = renderHook(() =>
      useRealtimeCollection(fetchFn, 'expenses', 'casa-1'),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.data).toEqual([{ id: '1' }, { id: '2' }]);
  });

  it('limpia el canal al desmontar', async () => {
    const fetchFn = jest.fn().mockResolvedValue([]);
    const { unmount } = renderHook(() =>
      useRealtimeCollection(fetchFn, 'expenses', 'casa-1'),
    );

    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    unmount();
    expect(mockRemoveChannel).toHaveBeenCalled();
  });

  it('recarga datos cuando llega un evento postgres_changes', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce([{ id: '1' }])
      .mockResolvedValueOnce([{ id: '1' }, { id: '2' }]);
    renderHook(() => useRealtimeCollection(fetchFn, 'expenses', 'casa-1'));

    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));

    const eventHandler = mockOn.mock.calls[0][2];
    await act(async () => {
      await eventHandler();
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('genera nombres de channel distintos entre mounts secuenciales', async () => {
    const fetchFn = jest.fn().mockResolvedValue([]);
    const first = renderHook(() =>
      useRealtimeCollection(fetchFn, 'expenses', 'casa-1'),
    );
    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    first.unmount();

    const second = renderHook(() =>
      useRealtimeCollection(fetchFn, 'expenses', 'casa-1'),
    );
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));
    second.unmount();

    expect(mockChannel.mock.calls[0][0]).not.toBe(mockChannel.mock.calls[1][0]);
  });

  it('genera nombre de channel distinto al cambiar de casa', async () => {
    const fetchFn = jest.fn().mockResolvedValue([]);
    const { rerender } = renderHook(
      ({ casaId }: { casaId: string | null }) =>
        useRealtimeCollection(fetchFn, 'expenses', casaId),
      { initialProps: { casaId: 'casa-1' } },
    );
    await waitFor(() => expect(fetchFn).toHaveBeenCalled());

    rerender({ casaId: 'casa-2' });
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));

    expect(mockChannel.mock.calls[0][0]).not.toBe(mockChannel.mock.calls[1][0]);
  });
});