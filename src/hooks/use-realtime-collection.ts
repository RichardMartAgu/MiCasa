import { useCallback, useEffect, useRef, useState } from 'react';

import { supabase } from '@/lib/supabase';

interface CollectionResult<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const FILTER_PATTERN =
  /^([a-zA-Z_][a-zA-Z0-9_]*)=(eq|neq|lt|lte|gt|gte|like|ilike|is|in)\.(\(?[a-zA-Z0-9_.,\-: ]*\)?)$/;

export function safeRealtimeFilter(
  filter: string | undefined,
  casaId: string,
  memberColumn = 'casa_id',
): string {
  const fallback = `${memberColumn}=eq.${casaId}`;
  if (!filter || !FILTER_PATTERN.test(filter)) {
    return fallback;
  }
  const [, column, , value] = filter.match(FILTER_PATTERN) ?? [];
  if (column === memberColumn && value !== casaId) {
    return fallback;
  }
  return filter;
}

export function useRealtimeCollection<T>(
  fetchFn: () => Promise<T[]>,
  table: string,
  casaId: string | null,
  filter?: string,
  memberColumn = 'casa_id',
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
    } catch (e) {
      if (active()) {
        setError(e instanceof Error ? e.message : 'No se pudieron cargar los datos.');
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

    const channelFilter = safeRealtimeFilter(filter, casaId, memberColumn);
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
  }, [casaId, table, filter, memberColumn, runFetch]);

  return { data, loading, error, reload };
}
