import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { Palette, Radius, Spacing } from '@/constants/theme';

export type TextFieldProps = TextInputProps & {
  label: string;
  error?: string | null;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
};

export function TextField({ label, error, leftIcon, rightIcon, style, ...rest }: TextFieldProps) {
  const [focused, setFocused] = useState(false);
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
          placeholderTextColor={Palette.textMuted}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[styles.input, style]}
          {...rest}
        />
        {rightIcon ? <View style={styles.icon}>{rightIcon}</View> : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
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
