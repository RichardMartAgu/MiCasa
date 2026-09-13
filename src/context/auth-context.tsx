import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import type { Session, User } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { buildRedirectUri, isWeb, parseCallbackUrl } from '@/lib/oauth';

export type AuthError = { message: string };

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<AuthError | null>;
  signUp: (
    email: string,
    password: string,
    displayName: string,
  ) => Promise<AuthError | null>;
  signInWithGoogle: () => Promise<AuthError | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function applyCallback(params: ReturnType<typeof parseCallbackUrl>): Promise<void> {
  if (params.code) {
    await supabase.auth.exchangeCodeForSession(params.code);
    return;
  }
  if (params.access_token && params.refresh_token) {
    await supabase.auth.setSession({
      access_token: params.access_token,
      refresh_token: params.refresh_token,
    });
  }
}

function finishWebRedirect(): void {
  if (
    typeof window !== 'undefined' &&
    typeof window.location?.hash === 'string' &&
    window.location.hash.length > 1
  ) {
    const params = parseCallbackUrl(window.location.href);
    if (params.access_token || params.code) {
      void applyCallback(params);
      const cleanUrl = window.location.pathname + window.location.search;
      window.history.replaceState(null, '', cleanUrl);
    }
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .catch(() => setSession(null))
      .finally(() => setLoading(false));

    if (isWeb()) finishWebRedirect();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      session,
      loading,
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        return error ? { message: friendlyError(error.message) } : null;
      },
      async signUp(email, password, displayName) {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { display_name: displayName.trim() },
            emailRedirectTo:
              Platform.OS === 'web' ? `${window.location.origin}/verify` : 'micasa://verify',
          },
        });
        return error ? { message: friendlyError(error.message) } : null;
      },
      async signInWithGoogle() {
        const redirectTo = buildRedirectUri();
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo,
            skipBrowserRedirect: Platform.OS !== 'web',
          },
        });
        if (error) return { message: friendlyError(error.message) };

        if (Platform.OS === 'web') {
          if (!data.url) return null;
          window.location.href = data.url;
        } else if (data.url) {
          const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
          if (result.type === 'success') {
            await applyCallback(parseCallbackUrl(result.url));
          }
        }
        return null;
      },
      async signOut() {
        await supabase.auth.signOut();
      },
    }),
    [session, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return context;
}