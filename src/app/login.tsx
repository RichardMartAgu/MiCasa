import { useState } from 'react';
import { Link, Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ActivityIndicator,
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
import { validateEmail, validatePassword } from '@/lib/validation';

const Warm = {
  bgTop: '#FAF6EF',
  bgBottom: '#F2E9DC',
  glowOlive: 'rgba(122, 132, 80, 0.20)',
  glowAmber: 'rgba(214, 176, 116, 0.30)',
  card: 'rgba(255, 255, 255, 0.58)',
  cardBorder: 'rgba(255, 255, 255, 0.95)',
  inputBg: 'rgba(255, 255, 255, 0.72)',
  inputBorder: 'rgba(176, 155, 128, 0.38)',
  olive: '#7A8450',
  olivePressed: '#646F3F',
  oliveSoft: 'rgba(122, 132, 80, 0.12)',
  wood: '#B08968',
  text: '#3B372F',
  textSoft: '#7A7163',
  textMuted: '#A69B8A',
  danger: '#C0523F',
} as const;

interface FieldProps extends TextInputProps {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  error?: string | null;
}

function Field({ label, icon, error, onFocus, onBlur, ...rest }: FieldProps) {
  const [focused, setFocused] = useState(false);
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
          color={error ? Warm.danger : focused ? Warm.olive : Warm.textMuted}
        />
        <TextInput
          style={styles.input}
          placeholderTextColor={Warm.textMuted}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...rest}
        />
      </View>
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

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
      <LinearGradient colors={[Warm.bgTop, Warm.bgBottom]} style={styles.background}>
        <LinearGradient
          colors={['rgba(214, 176, 116, 0.00)', Warm.glowAmber]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          pointerEvents="none"
          style={styles.glowTop}
        />
        <LinearGradient
          colors={[Warm.glowOlive, 'rgba(122, 132, 80, 0.00)']}
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
              colors={[Warm.oliveSoft, 'rgba(176, 137, 104, 0.10)']}
              style={styles.logo}>
              <Ionicons name="home-outline" size={30} color={Warm.olive} />
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
            disabled={loading}
            onPress={handleSubmit}
            style={({ pressed }) => [
              styles.button,
              (pressed || loading) && styles.buttonPressed,
            ]}>
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
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
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Warm.bgTop },
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
    color: Warm.textSoft,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  greeting: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: Warm.text,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: Warm.textSoft,
    textAlign: 'center',
    marginTop: 6,
  },
  card: {
    backgroundColor: Warm.card,
    borderColor: Warm.cardBorder,
    borderWidth: 1,
    borderRadius: 28,
    padding: 24,
    gap: 18,
    shadowColor: Warm.wood,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 28,
    elevation: 6,
  },
  fieldContainer: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Warm.textSoft,
  },
  fieldInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Warm.inputBg,
    borderWidth: 1,
    borderColor: Warm.inputBorder,
    borderRadius: 16,
    paddingHorizontal: 16,
    minHeight: 54,
  },
  fieldInputFocused: {
    borderColor: Warm.olive,
    borderWidth: 1.5,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
  },
  fieldInputError: {
    borderColor: Warm.danger,
    borderWidth: 1.5,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: Warm.text,
    minHeight: 54,
    paddingVertical: 0,
  },
  fieldError: {
    fontSize: 13,
    color: Warm.danger,
  },
  formError: {
    color: Warm.danger,
    fontSize: 14,
    textAlign: 'center',
  },
  button: {
    backgroundColor: Warm.olive,
    borderRadius: 20,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Warm.olive,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 5,
  },
  buttonPressed: {
    backgroundColor: Warm.olivePressed,
  },
  buttonLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  linkCenter: {
    color: Warm.olive,
    fontWeight: '700',
    fontSize: 15,
    textAlign: 'center',
  },
  footer: {
    textAlign: 'center',
    fontSize: 15,
    color: Warm.textSoft,
    marginTop: 2,
  },
  link: {
    color: Warm.olive,
    fontWeight: '700',
  },
});
