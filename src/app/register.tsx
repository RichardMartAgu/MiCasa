import { useState } from 'react';
import { Link, Redirect } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import {
  validateDisplayName,
  validateEmail,
  validatePassword,
} from '@/lib/validation';

export default function RegisterScreen() {
  const { session, signUp } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{
    name?: string;
    email?: string;
    password?: string;
    form?: string;
  }>({});
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  if (session) return <Redirect href="/" />;

  async function handleSubmit() {
    const nameCheck = validateDisplayName(displayName);
    const emailCheck = validateEmail(email);
    const passwordCheck = validatePassword(password);
    setErrors({
      name: nameCheck.valid ? undefined : nameCheck.message,
      email: emailCheck.valid ? undefined : emailCheck.message,
      password: passwordCheck.valid ? undefined : passwordCheck.message,
    });
    if (!nameCheck.valid || !emailCheck.valid || !passwordCheck.valid) return;

    setLoading(true);
    const error = await signUp(email, password, displayName);
    setLoading(false);
    if (error) {
      setErrors({ form: error.message });
    } else {
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
          <Text style={styles.title}>Crear cuenta</Text>
          <Text style={styles.subtitle}>Empieza a gestionar tu hogar hoy</Text>
        </View>

        {sent ? (
          <View style={styles.form}>
            <Text style={styles.success}>
              Cuenta creada. Revisa tu correo para confirmar el registro y vuelve a iniciar
              sesión.
            </Text>
            <Link href="/login" style={styles.linkCenter}>
              Ir a iniciar sesión
            </Link>
          </View>
        ) : (
          <View style={styles.form}>
            <TextField
              label="Tu nombre"
              value={displayName}
              onChangeText={setDisplayName}
              autoComplete="name"
              error={errors.name}
            />
            <TextField
              label="Correo electrónico"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              error={errors.email}
            />
            <TextField
              label="Contraseña"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="new-password"
              error={errors.password}
            />

            {errors.form ? (
              <Text style={styles.formError} accessibilityRole="alert">
                {errors.form}
              </Text>
            ) : null}

            <Button title="Crear cuenta" onPress={handleSubmit} loading={loading} />

            <Text style={styles.footer}>
              ¿Ya tienes cuenta?{' '}
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
