import { useState } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { Palette, Radius, Spacing } from '@/constants/theme';

export type TextFieldProps = TextInputProps & {
  label: string;
  error?: string | null;
};

export function TextField({ label, error, style, ...rest }: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={Palette.textMuted}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          styles.input,
          style,
          focused && styles.inputFocused,
          error && styles.inputError,
        ]}
        {...rest}
      />
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
  input: {
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
    color: Palette.text,
    backgroundColor: Palette.surface,
    minHeight: 48,
  },
  inputFocused: {
    borderColor: Palette.primary,
    borderWidth: 2,
    paddingVertical: Spacing.three - 1,
  },
  inputError: {
    borderColor: Palette.danger,
    borderWidth: 2,
    paddingVertical: Spacing.three - 1,
  },
  error: {
    fontSize: 13,
    color: Palette.danger,
  },
});
