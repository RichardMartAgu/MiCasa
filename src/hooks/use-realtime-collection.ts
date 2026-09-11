import { useCallback, useEffect, useRef, useState } from 'react';

import { supabase } from '@/lib/supabase';

interface CollectionResult<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useRealtimeCollection<T>(
  fetchFn: () => Promise<T[]>,
  table: string,
  casaId: string | null,
  filter?: string,
): CollectionResult<T> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchRef = useRef(fetchFn);

  useEffect(() => {
    fetchRef.current = fetchFn;
  }, [fetchFn]);

  const runFetch = useCallback(async (active: () => boolean) => {
    try {
      const rows = await fetchRef.current();
      if (active()) {
        setData(rows);
        setError(null);
        setLoading(false);
      }
    } catch {
      if (active()) {
        setError('No se pudieron cargar los datos.');
        setLoading(false);
      }
    }
  }, []);

  const reload = useCallback(async () => {
    await runFetch(() => true);
  }, [runFetch]);

  useEffect(() => {
    if (!casaId) {
      return;
    }

    let active = true;
    const isActive = () => active;
    runFetch(isActive);

    const channelFilter = filter ?? `casa_id=eq.${casaId}`;
    const channel = supabase
      .channel(`realtime-${table}-${casaId}-${channelFilter}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
          filter: channelFilter,
        },
        () => {
          runFetch(isActive);
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [casaId, table, filter, runFetch]);

  return { data, loading, error, reload };
}
