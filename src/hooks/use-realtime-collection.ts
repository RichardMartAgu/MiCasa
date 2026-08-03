import { useCallback, useEffect, useRef, useState } from 'react';

import { supabase } from '@/lib/supabase';

interface CollectionResult<T> {
  data: T[];
  loading: boolean;
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
  const fetchRef = useRef(fetchFn);

  useEffect(() => {
    fetchRef.current = fetchFn;
  }, [fetchFn]);

  const reload = useCallback(async () => {
    const rows = await fetchRef.current();
    setData(rows);
  }, []);

  useEffect(() => {
    if (!casaId) {
      return;
    }

    let active = true;
    fetchRef.current().then((rows) => {
      if (active) {
        setData(rows);
        setLoading(false);
      }
    });

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
          fetchRef.current().then((rows) => {
            if (active) setData(rows);
          });
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [casaId, table, filter]);

  return { data, loading, reload };
}
