import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuth } from '@/context/auth-context';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { removeCasa, updateCasa } from '@/lib/api';
import type { Casa, CasaMember, Profile } from '@/lib/types';

const CURRENT_CASA_KEY = 'micasa.current_casa_id';

let channelSeq = 0;

async function fetchMembersForCasa(casaId: string) {
  const { data } = await supabase
    .from('casa_members')
    .select('*')
    .eq('casa_id', casaId);
  const rows = data ?? [];
  const members: CasaMember[] = rows.map((m) => ({
    ...m,
    role: m.role === 'owner' || m.role === 'admin' ? m.role : 'member',
  }));

  const userIds = rows.map((m) => m.user_id);
  let profiles: Record<string, Profile | null> = {};
  if (userIds.length > 0) {
    const { data: profileRows } = await supabase
      .from('profiles')
      .select('*')
      .in('id', userIds);
    profiles = {};
    for (const id of userIds) {
      profiles[id] = profileRows?.find((p) => p.id === id) ?? null;
    }
  }

  return { members, profiles };
}

export type CasaError = { message: string };

interface CasaContextValue {
  casas: Casa[];
  currentCasa: Casa | null;
  members: CasaMember[];
  profiles: Record<string, Profile | null>;
  loading: boolean;
  setCurrentCasa: (casa: Casa) => Promise<void>;
  createCasa: (name: string) => Promise<CasaError | null>;
  joinCasa: (code: string) => Promise<CasaError | null>;
  renameCasa: (id: string, name: string) => Promise<CasaError | null>;
  deleteCasa: (id: string) => Promise<CasaError | null>;
  refresh: () => Promise<void>;
  refreshMembers: () => Promise<void>;
}

const CasaContext = createContext<CasaContextValue | undefined>(undefined);

export function CasaProvider({ children }: { children: ReactNode }) {
  const { loading: authLoading, user } = useAuth();
  const [casas, setCasas] = useState<Casa[]>([]);
  const [currentCasa, setCurrentCasaState] = useState<Casa | null>(null);
  const [membersByCasa, setMembersByCasa] = useState<Record<string, CasaMember[]>>({});
  const [profilesByCasa, setProfilesByCasa] = useState<
    Record<string, Record<string, Profile | null>>
  >({});
  const [loading, setLoading] = useState(true);

  const members = useMemo(
    () => (currentCasa ? (membersByCasa[currentCasa.id] ?? []) : []),
    [currentCasa, membersByCasa],
  );
  const profiles = useMemo(
    () => (currentCasa ? (profilesByCasa[currentCasa.id] ?? {}) : {}),
    [currentCasa, profilesByCasa],
  );

  const refresh = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setCasas([]);
      setCurrentCasaState(null);
      setLoading(false);
      return;
    }

    const { data: casaRows } = await supabase
      .from('casas')
      .select('*')
      .order('created_at', { ascending: true });

    const owned: Casa[] = casaRows ?? [];
    setCasas(owned);

    const stored = await AsyncStorage.getItem(CURRENT_CASA_KEY);
    let selected = owned.find((c) => c.id === stored) ?? owned[0] ?? null;
    if (selected) await AsyncStorage.setItem(CURRENT_CASA_KEY, selected.id);
    setCurrentCasaState(selected);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    void (async () => {
      await refresh();
    })();
  }, [authLoading, user?.id, refresh]);

  useEffect(() => {
    if (!user?.id) return;

    const channelName = `realtime-casas-${channelSeq++}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'casas' },
        () => {
          void refresh();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, refresh]);

  const setCurrentCasa = useCallback(async (casa: Casa) => {
    await AsyncStorage.setItem(CURRENT_CASA_KEY, casa.id);
    setCurrentCasaState(casa);
  }, []);

  useEffect(() => {
    if (!currentCasa) return;
    let active = true;

    (async () => {
      const result = await fetchMembersForCasa(currentCasa.id);
      if (!active) return;
      setMembersByCasa((prev) => ({ ...prev, [currentCasa.id]: result.members }));
      setProfilesByCasa((prev) => ({ ...prev, [currentCasa.id]: result.profiles }));
    })();

    return () => {
      active = false;
    };
  }, [currentCasa]);

  const refreshMembers = useCallback(async () => {
    if (!currentCasa) return;
    const result = await fetchMembersForCasa(currentCasa.id);
    setMembersByCasa((prev) => ({ ...prev, [currentCasa.id]: result.members }));
    setProfilesByCasa((prev) => ({ ...prev, [currentCasa.id]: result.profiles }));
  }, [currentCasa]);

  const createCasa = useCallback(
    async (name: string): Promise<CasaError | null> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return { message: 'Sesión no válida.' };

      const { data, error } = await supabase
        .from('casas')
        .insert({ name: name.trim(), created_by: user.id })
        .select()
        .single();

      if (error) return { message: friendlyError(error.message) };
      await refresh();
      await setCurrentCasa(data);
      return null;
    },
    [refresh, setCurrentCasa],
  );

  const joinCasa = useCallback(
    async (code: string): Promise<CasaError | null> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return { message: 'Sesión no válida.' };

      const { data: casa, error } = await supabase.rpc('join_casa', {
        code: code.trim().toUpperCase(),
      });
      if (error) return { message: friendlyError(error.message) };
      if (!casa) return { message: 'No existe ninguna casa con ese código.' };

      await refresh();
      await setCurrentCasa(casa as Casa);
      return null;
    },
    [refresh, setCurrentCasa],
  );

  const renameCasa = useCallback(
    async (id: string, name: string): Promise<CasaError | null> => {
      const error = await updateCasa(id, { name: name.trim() });
      if (error) return error;
      await refresh();
      return null;
    },
    [refresh],
  );

  const deleteCasa = useCallback(
    async (id: string): Promise<CasaError | null> => {
      const error = await removeCasa(id);
      if (error) return error;
      await refresh();
      return null;
    },
    [refresh],
  );

  const value = useMemo<CasaContextValue>(
    () => ({
      casas,
      currentCasa,
      members,
      profiles,
      loading,
      setCurrentCasa,
      createCasa,
      joinCasa,
      renameCasa,
      deleteCasa,
      refresh,
      refreshMembers,
    }),
    [casas, currentCasa, members, profiles, loading, setCurrentCasa, createCasa, joinCasa, renameCasa, deleteCasa, refresh, refreshMembers],
  );

  return <CasaContext.Provider value={value}>{children}</CasaContext.Provider>;
}

export function useCasa(): CasaContextValue {
  const context = useContext(CasaContext);
  if (!context) throw new Error('useCasa debe usarse dentro de <CasaProvider>');
  return context;
}
