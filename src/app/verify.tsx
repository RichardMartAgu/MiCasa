import { useEffect, useState } from 'react';
import { Link, Redirect } from 'expo-router';
import * as Linking from 'expo-linking';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { Palette, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/lib/supabase';

type Phase = 'loading' | 'verified' | 'error';

interface VerifyTokens {
  access_token: string;
  refresh_token: string;
}

function parseVerifyUrl(raw?: string | null): VerifyTokens | null {
  if (!raw) return null;
  const hashIndex = raw.indexOf('#');
  const query = hashIndex >= 0 ? raw.slice(hashIndex + 1) : raw.split('?')[1] ?? '';
  const params = new URLSearchParams(query);
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  const type = params.get('type');
  if (
    (type === 'signup' || type === 'email_change' || type === 'recovery') &&
    access_token &&
    refresh_token
  ) {
    return { access_token, refresh_token };
  }
  return null;
}

export default function VerifyScreen() {
  const { session } = useAuth();
  const [phase, setPhase] = useState<Phase>('loading');

  useEffect(() => {
    let cancelled = false;

    async function applyTokens(tokens: VerifyTokens | null) {
      if (Platform.OS === 'web') {
        window.history.replaceState(null, '', window.location.pathname);
      }
      if (cancelled) return;
      if (!tokens) {
        setPhase('error');
        return;
      }
      const { error } = await supabase.auth.setSession(tokens);
      if (cancelled) return;
      setPhase(error ? 'error' : 'verified');
    }

    async function init() {
      if (Platform.OS === 'web') {
        const raw = typeof window !== 'undefined' ? window.location.hash : null;
        await applyTokens(parseVerifyUrl(raw));
      } else {
        const url = await Linking.getInitialURL();
        if (!cancelled) await applyTokens(parseVerifyUrl(url));
      }
    }

    void init();

    if (Platform.OS !== 'web') {
      const subscription = Linking.addEventListener('url', ({ url }) => {
        void applyTokens(parseVerifyUrl(url));
      });
      return () => {
        cancelled = true;
        subscription.remove();
      };
    }

    return () => {
      cancelled = true;
    };
  }, []);

  if (session && phase !== 'error') return <Redirect href="/" />;

  return (
    <View style={styles.center}>
      {phase === 'loading' ? (
        <>
          <Text style={styles.title}>Verificando tu correo...</Text>
          <Text style={styles.subtitle}>Un momento, por favor.</Text>
        </>
      ) : phase === 'verified' ? (
        <>
          <Text style={styles.title}>Correo verificado</Text>
          <Text style={styles.subtitle}>Tu cuenta está confirmada. Ya puedes entrar.</Text>
          <Link href="/login" style={styles.link}>
            Iniciar sesión
          </Link>
        </>
      ) : (
        <>
          <Text style={styles.errorText} accessibilityRole="alert">
            Enlace no válido o expirado.
          </Text>
          <Link href="/register" style={styles.link}>
            Crear cuenta de nuevo
          </Link>
          <Link href="/login" style={styles.link}>
            Iniciar sesión
          </Link>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: Palette.background,
    padding: Spacing.four,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.three,
  },
  title: { fontSize: 24, fontWeight: '800', color: Palette.text, textAlign: 'center' },
  subtitle: { fontSize: 16, color: Palette.textSecondary, textAlign: 'center' },
  errorText: { color: Palette.danger, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  link: { color: Palette.primary, fontWeight: '700', fontSize: 15 },
});