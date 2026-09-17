import { useState } from 'react';
import { Link, Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { useAuth } from '@/context/auth-context';
import { Palette, Shadow } from '@/constants/theme';
import { Spinner } from '@/components/ui/spinner';
import { validateEmail, validatePassword } from '@/lib/validation';

interface FieldProps extends TextInputProps {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  error?: string | null;
}

function Field({ label, icon, error, onFocus, onBlur, ...rest }: FieldProps) {
  const [focused, setFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { secureTextEntry, ...restInput } = rest;
  return (
    <View style={styles.fieldContainer}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View
        style={[
          styles.fieldInput,
          focused && styles.fieldInputFocused,
          error && styles.fieldInputError,
        ]}>
        <Ionicons
          name={icon}
          size={18}
          color={error ? Palette.danger : focused ? Palette.accent : Palette.textMuted}
        />
        <TextInput
          style={styles.input}
          placeholderTextColor={Palette.textMuted}
          secureTextEntry={secureTextEntry ? !showPassword : undefined}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...restInput}
        />
        {secureTextEntry ? (
          <Pressable
            style={styles.eyeButton}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            accessibilityState={{ checked: showPassword }}
            onPress={() => setShowPassword((v) => !v)}>
            <Ionicons
              name={showPassword ? 'eye-off-outline' : 'eye-outline'}
              size={22}
              color={Palette.textMuted}
            />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

export default function LoginScreen() {
  const { session, signIn, signInWithGoogle } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  if (session) return <Redirect href="/" />;

  async function handleGoogle() {
    setGoogleLoading(true);
    const error = await signInWithGoogle();
    setGoogleLoading(false);
    if (error) setErrors({ form: error.message });
  }

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
      <LinearGradient colors={[Palette.bg, Palette.surface]} style={styles.background}>
        <LinearGradient
          colors={['rgba(56, 189, 248, 0.00)', 'rgba(56, 189, 248, 0.14)']}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          pointerEvents="none"
          style={styles.glowTop}
        />
        <LinearGradient
          colors={['rgba(59, 130, 246, 0.14)', 'rgba(59, 130, 246, 0.00)']}
          start={{ x: 0, y: 1 }}
          end={{ x: 0, y: 0 }}
          pointerEvents="none"
          style={styles.glowBottom}
        />
      </LinearGradient>

      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
            <LinearGradient
              colors={[Palette.primarySoft, 'rgba(56, 189, 248, 0.10)']}
              style={styles.logo}>
              <Ionicons name="home-outline" size={30} color={Palette.accent} />
            </LinearGradient>
            <Text style={styles.brand}>MiCasa</Text>
            <Text style={styles.greeting}>Bienvenido a casa</Text>
            <Text style={styles.subtitle}>Entra para gestionar tu hogar</Text>
          </View>

        <View style={styles.card}>
          <Field
            label="Correo electrónico"
            icon="mail-outline"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            error={errors.email}
          />
          <Field
            label="Contraseña"
            icon="key-outline"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            error={errors.password}
          />

          {errors.form ? (
            <Text style={styles.formError} accessibilityRole="alert">
              {errors.form}
            </Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy: loading }}
            disabled={loading}
            onPress={handleSubmit}
            style={({ pressed }) => [
              styles.button,
              (pressed || loading) && styles.buttonPressed,
            ]}>
            {loading ? (
              <Spinner size="small" color={Palette.onPrimary} />
            ) : (
              <Text style={styles.buttonLabel}>Entrar</Text>
            )}
          </Pressable>

          <Text style={styles.linkCenter}>
            <Link href="/recuperar" style={styles.link}>
              ¿Olvidaste tu contraseña?
            </Link>
          </Text>

          <Text style={styles.footer}>
            ¿No tienes cuenta?{' '}
            <Link href="/register" style={styles.link}>
              Regístrate
            </Link>
          </Text>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>o</Text>
            <View style={styles.dividerLine} />
          </View>

          <Pressable
            accessibilityRole="button"
            disabled={googleLoading}
            onPress={handleGoogle}
            style={({ pressed }) => [
              styles.googleButton,
              (pressed || googleLoading) && styles.googleButtonPressed,
            ]}>
            <Ionicons name="logo-google" size={18} color={Palette.textSecondary} />
            <Text style={styles.googleLabel}>
              {googleLoading ? 'Abriendo Google…' : 'Continuar con Google'}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Palette.bg },
  background: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  glowTop: {
    position: 'absolute',
    top: -160,
    left: -80,
    right: -80,
    height: 340,
  },
  glowBottom: {
    position: 'absolute',
    bottom: -140,
    left: -100,
    right: -100,
    height: 330,
  },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 28,
  },
  logo: {
    width: 68,
    height: 68,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  brand: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 4,
    color: Palette.textSecondary,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  greeting: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: Palette.text,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: Palette.textSecondary,
    textAlign: 'center',
    marginTop: 6,
  },
  card: {
    backgroundColor: Palette.surface,
    borderColor: Palette.border,
    borderWidth: 1,
    borderRadius: 28,
    padding: 24,
    gap: 18,
    ...Shadow.card,
  },
  fieldContainer: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Palette.textSecondary,
  },
  fieldInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Palette.surfaceAlt,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 16,
    paddingHorizontal: 16,
    minHeight: 54,
  },
  fieldInputFocused: {
    borderColor: Palette.primary,
    borderWidth: 1.5,
    backgroundColor: Palette.surface,
  },
  fieldInputError: {
    borderColor: Palette.danger,
    borderWidth: 1.5,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: Palette.text,
    minHeight: 54,
    paddingVertical: 0,
  },
  eyeButton: {
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 44,
    minWidth: 44,
  },
  fieldError: {
    fontSize: 13,
    color: Palette.danger,
  },
  formError: {
    color: Palette.danger,
    fontSize: 14,
    textAlign: 'center',
  },
  button: {
    backgroundColor: Palette.primary,
    borderRadius: 20,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.fab,
  },
  buttonPressed: {
    backgroundColor: Palette.primaryPressed,
  },
  buttonLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: Palette.onPrimary,
  },
  linkCenter: {
    color: Palette.primary,
    fontWeight: '700',
    fontSize: 15,
    textAlign: 'center',
  },
  footer: {
    textAlign: 'center',
    fontSize: 15,
    color: Palette.textSecondary,
    marginTop: 2,
  },
  link: {
    color: Palette.primary,
    fontWeight: '700',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: Palette.border,
  },
  dividerText: {
    fontSize: 13,
    color: Palette.textMuted,
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Palette.surfaceAlt,
    borderWidth: 1,
    borderColor: Palette.borderStrong,
    borderRadius: 20,
    minHeight: 52,
    ...Shadow.fab,
  },
  googleButtonPressed: {
    backgroundColor: Palette.surfaceMuted,
    opacity: 0.85,
  },
  googleLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: Palette.text,
  },
});