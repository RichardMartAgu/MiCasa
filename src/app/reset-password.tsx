import { useEffect, useState } from 'react';
import { Link, Redirect } from 'expo-router';
import * as Linking from 'expo-linking';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { Palette, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { friendlyError } from '@/lib/errors';
import { validatePassword } from '@/lib/validation';
import { supabase } from '@/lib/supabase';

type Phase = 'loading' | 'ready' | 'done' | 'error';

interface RecoveryTokens {
  access_token: string;
  refresh_token: string;
}

function parseRecoveryUrl(raw?: string | null): RecoveryTokens | null {
  if (!raw) return null;
  const hashIndex = raw.indexOf('#');
  const query = hashIndex >= 0 ? raw.slice(hashIndex + 1) : raw.split('?')[1] ?? '';
  const params = new URLSearchParams(query);
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (params.get('type') === 'recovery' && access_token && refresh_token) {
    return { access_token, refresh_token };
  }
  return null;
}

export default function ResetPasswordScreen() {
  const { session } = useAuth();
  const [phase, setPhase] = useState<Phase>('loading');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string; form?: string }>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function applyTokens(tokens: RecoveryTokens | null) {
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
      setPhase(error ? 'error' : 'ready');
    }

    async function init() {
      if (Platform.OS === 'web') {
        const raw = typeof window !== 'undefined' ? window.location.hash : null;
        await applyTokens(parseRecoveryUrl(raw));
      } else {
        const url = await Linking.getInitialURL();
        if (!cancelled) await applyTokens(parseRecoveryUrl(url));
      }
    }

    void init();

    if (Platform.OS !== 'web') {
      const subscription = Linking.addEventListener('url', ({ url }) => {
        void applyTokens(parseRecoveryUrl(url));
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

  if (session && phase === 'error') return <Redirect href="/" />;

  async function handleSubmit() {
    const passCheck = validatePassword(password);
    const confirmValid = confirm.length > 0 && confirm === password;
    setErrors({
      password: passCheck.valid ? undefined : passCheck.message,
      confirm: confirmValid ? undefined : 'Las contraseñas no coinciden.',
    });
    if (!passCheck.valid || !confirmValid) return;

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      setErrors({ form: friendlyError(error.message) });
    } else {
      setPhase('done');
    }
  }

  if (phase === 'loading') {
    return (
      <View style={styles.center}>
        <Text style={styles.loadingText}>Cargando...</Text>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText} accessibilityRole="alert">
          Enlace no válido o expirado.
        </Text>
        <Link href="/recuperar" style={styles.link}>
          Solicitar nuevo enlace
        </Link>
      </View>
    );
  }

  return (
    <View style={styles.center}>
      {phase === 'done' ? (
        <>
          <Text style={styles.title}>Contraseña actualizada</Text>
          <Text style={styles.subtitle}>
            Ya puedes iniciar sesión con tu nueva contraseña.
          </Text>
          <Link href="/login" style={styles.link}>
            Iniciar sesión
          </Link>
        </>
      ) : (
        <>
          <Text style={styles.title}>Nueva contraseña</Text>
          <Text style={styles.subtitle}>Introduce tu nueva contraseña dos veces.</Text>

          <View style={styles.form}>
            <TextField
              label="Nueva contraseña"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="new-password"
              error={errors.password}
            />
            <TextField
              label="Confirmar contraseña"
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry
              autoComplete="new-password"
              error={errors.confirm}
            />

            {errors.form ? (
              <Text style={styles.formError} accessibilityRole="alert">
                {errors.form}
              </Text>
            ) : null}

            <Button title="Guardar contraseña" onPress={handleSubmit} loading={loading} />
          </View>
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
    gap: Spacing.four,
  },
  title: { fontSize: 32, fontWeight: '800', color: Palette.text, textAlign: 'center' },
  subtitle: { fontSize: 16, color: Palette.textSecondary, textAlign: 'center' },
  form: { width: '100%', gap: Spacing.four },
  formError: { color: Palette.danger, fontSize: 14, textAlign: 'center' },
  loadingText: { color: Palette.textSecondary, fontSize: 16 },
  errorText: { color: Palette.danger, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  link: { color: Palette.primary, fontWeight: '700', fontSize: 15 },
});