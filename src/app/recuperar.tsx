import { useState } from 'react';
import { Link, Redirect } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { friendlyError } from '@/lib/errors';
import { validateEmail } from '@/lib/validation';
import { supabase } from '@/lib/supabase';

const MAX_EMAIL_LENGTH = 254;
const RESEND_COOLDOWN_MS = 30_000;

export default function RecuperarScreen() {
  const { session } = useAuth();
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<{ email?: string; form?: string }>({});
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);

  if (session) return <Redirect href="/" />;

  async function handleSubmit() {
    const normalized = email.trim();
    const emailCheck = validateEmail(normalized);
    const tooLong = normalized.length > MAX_EMAIL_LENGTH;
    const emailError = tooLong
      ? 'El correo es demasiado largo.'
      : emailCheck.valid
        ? undefined
        : emailCheck.message;
    setErrors({ email: emailError });
    if (!emailCheck.valid || tooLong) return;

    if (lastSentAt && Date.now() - lastSentAt < RESEND_COOLDOWN_MS) {
      setErrors({ form: 'Espera unos segundos antes de volver a enviar el enlace.' });
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(normalized, {
      redirectTo:
        Platform.OS === 'web'
          ? `${window.location.origin}/reset-password`
          : undefined,
    });
    setLoading(false);

    if (error) {
      setErrors({ form: friendlyError(error.message) });
    } else {
      setLastSentAt(Date.now());
      setSent(true);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.logo}>🏠</Text>
          <Text style={styles.title}>Recuperar contraseña</Text>
          <Text style={styles.subtitle}>Te enviaremos un enlace para restablecerla</Text>
        </View>

        {sent ? (
          <View style={styles.form}>
            <Text style={styles.success}>
              Revisa tu correo electrónico. Enviamos un enlace para restablecer tu contraseña.
            </Text>
            <Link href="/login" style={styles.linkCenter}>
              Volver a iniciar sesión
            </Link>
          </View>
        ) : (
          <View style={styles.form}>
            <TextField
              label="Correo electrónico"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              error={errors.email}
            />

            {errors.form ? <Text style={styles.formError}>{errors.form}</Text> : null}

            <Button title="Enviar enlace" onPress={handleSubmit} loading={loading} />

            <Text style={styles.footer}>
              ¿Recuerdas tu contraseña?{' '}
              <Link href="/login" style={styles.link}>
                Inicia sesión
              </Link>
            </Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Palette.background },
  container: {
    flexGrow: 1,
    padding: Spacing.four,
    justifyContent: 'center',
    gap: Spacing.five,
  },
  header: { alignItems: 'center', gap: Spacing.two },
  logo: {
    fontSize: 56,
    backgroundColor: Palette.primarySoft,
    width: 112,
    height: 112,
    borderRadius: Radius.pill,
    textAlign: 'center',
    lineHeight: 112,
    overflow: 'hidden',
  },
  title: { fontSize: 32, fontWeight: '800', color: Palette.text },
  subtitle: { fontSize: 16, color: Palette.textSecondary, textAlign: 'center' },
  form: { gap: Spacing.four },
  formError: { color: Palette.danger, fontSize: 14, textAlign: 'center' },
  success: {
    color: Palette.success,
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
  },
  linkCenter: {
    color: Palette.primary,
    fontWeight: '700',
    fontSize: 15,
    textAlign: 'center',
  },
  footer: { textAlign: 'center', fontSize: 15, color: Palette.textStrong },
  link: { color: Palette.primary, fontWeight: '700' },
});
