import { useState } from 'react';
import { Link, Redirect } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { validateEmail, validatePassword } from '@/lib/validation';

export default function LoginScreen() {
  const { session, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [loading, setLoading] = useState(false);

  if (session) return <Redirect href="/" />;

  async function handleSubmit() {
    const emailCheck = validateEmail(email);
    const passwordCheck = validatePassword(password);
    setErrors({
      email: emailCheck.valid ? undefined : emailCheck.message,
      password: passwordCheck.valid ? undefined : passwordCheck.message,
    });
    if (!emailCheck.valid || !passwordCheck.valid) return;

    setLoading(true);
    const error = await signIn(email, password);
    setLoading(false);
    if (error) setErrors({ form: error.message });
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.logo}>🏠</Text>
          <Text style={styles.title}>MiCasa</Text>
          <Text style={styles.subtitle}>La gestión de tu hogar, en un solo lugar</Text>
        </View>

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
          <TextField
            label="Contraseña"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            error={errors.password}
          />

          {errors.form ? <Text style={styles.formError}>{errors.form}</Text> : null}

          <Button title="Entrar" onPress={handleSubmit} loading={loading} />

          <Text style={styles.footer}>
            ¿No tienes cuenta?{' '}
            <Link href="/register" style={styles.link}>
              Regístrate
            </Link>
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#ffffff' },
  container: {
    flexGrow: 1,
    padding: Spacing.four,
    justifyContent: 'center',
    gap: Spacing.five,
  },
  header: { alignItems: 'center', gap: Spacing.two },
  logo: { fontSize: 56 },
  title: { fontSize: 36, fontWeight: '700', color: '#111827' },
  subtitle: { fontSize: 16, color: '#6b7280', textAlign: 'center' },
  form: { gap: Spacing.four },
  formError: { color: '#dc2626', fontSize: 14, textAlign: 'center' },
  footer: { textAlign: 'center', fontSize: 15, color: '#4b5563' },
  link: { color: '#3c87f7', fontWeight: '600' },
});
