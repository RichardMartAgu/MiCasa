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

let channelSeq = 0;

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
  const [dataKey, setDataKey] = useState<string | null>(null);
  const fetchRef = useRef(fetchFn);

  const channelFilter = casaId ? safeRealtimeFilter(filter, casaId, memberColumn) : null;
  const queryKey = casaId && channelFilter ? `${table}|${casaId}|${channelFilter}` : null;

  useEffect(() => {
    fetchRef.current = fetchFn;
  }, [fetchFn]);

  const runFetch = useCallback(async (active: () => boolean, key: string) => {
    try {
      const rows = await fetchRef.current();
      if (active()) {
        setData(rows);
        setDataKey(key);
        setError(null);
        setLoading(false);
      }
    } catch (e) {
      if (active()) {
        setData([]);
        setDataKey(key);
        setError(e instanceof Error ? e.message : 'No se pudieron cargar los datos.');
        setLoading(false);
      }
    }
  }, []);

  const reload = useCallback(async () => {
    if (queryKey && dataKey === queryKey) await runFetch(() => true, queryKey);
  }, [dataKey, queryKey, runFetch]);

  useEffect(() => {
    if (!casaId || !channelFilter || !queryKey) {
      return;
    }

    let active = true;
    const isActive = () => active;
    runFetch(isActive, queryKey);

    const channelName = `realtime-${table}-${casaId}-${channelFilter}-${channelSeq++}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
          filter: channelFilter,
        },
        () => {
          runFetch(isActive, queryKey);
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [casaId, channelFilter, queryKey, table, runFetch]);

  const isCurrent = dataKey === queryKey;
  return {
    data: isCurrent ? data : [],
    loading: queryKey ? (isCurrent ? loading : true) : false,
    error: isCurrent ? error : null,
    reload,
  };
}
