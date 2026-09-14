import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Palette, Radius, Spacing } from '@/constants/theme';

export type TextFieldProps = TextInputProps & {
  label: string;
  error?: string | null;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
};

export function TextField({
  label,
  error,
  leftIcon,
  rightIcon,
  secureTextEntry,
  style,
  ...rest
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const [show, setShow] = useState(false);
  const isSecure = secureTextEntry === true;
  const toggleIcon: keyof typeof Ionicons.glyphMap = show ? 'eye-off-outline' : 'eye-outline';
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <View
        style={[
          styles.inputWrap,
          focused && styles.inputFocused,
          error && styles.inputError,
        ]}>
        {leftIcon ? <View style={styles.icon}>{leftIcon}</View> : null}
        <TextInput
          accessibilityLabel={label}
          aria-invalid={error != null}
          placeholderTextColor={Palette.textMuted}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          secureTextEntry={isSecure ? !show : undefined}
          style={[styles.input, style]}
          {...rest}
        />
        {isSecure ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            accessibilityState={{ checked: show }}
            hitSlop={8}
            onPress={() => setShow((prev) => !prev)}
            style={styles.toggle}>
            <Ionicons name={toggleIcon} size={22} color={Palette.textMuted} />
          </Pressable>
        ) : rightIcon ? (
          <View style={styles.icon}>{rightIcon}</View>
        ) : null}
      </View>
      {error ? (
        <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.two,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: Palette.textStrong,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.md,
    backgroundColor: Palette.surface,
    minHeight: 48,
  },
  icon: {
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toggle: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
  },
  input: {
    flex: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
    color: Palette.text,
    minHeight: 48,
  },
  inputFocused: {
    borderColor: Palette.primary,
    borderWidth: 2,
  },
  inputError: {
    borderColor: Palette.danger,
    borderWidth: 2,
  },
  error: {
    fontSize: 13,
    color: Palette.danger,
  },
});