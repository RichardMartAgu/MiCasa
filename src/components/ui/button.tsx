import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Palette, Radius, Shadow, Spacing } from '@/constants/theme';

export type ButtonProps = Omit<PressableProps, 'style'> & {
  title: string;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
};

const BACKGROUND = {
  primary: Palette.primary,
  secondary: Palette.surface,
  danger: Palette.danger,
} as const;

const BACKGROUND_PRESSED = {
  primary: Palette.primaryPressed,
  secondary: Palette.surfacePressed,
  danger: Palette.dangerPressed,
} as const;

const FOREGROUND = {
  primary: Palette.onPrimary,
  secondary: Palette.textStrong,
  danger: Palette.onPrimary,
} as const;

const BORDER = {
  primary: 'transparent',
  secondary: Palette.border,
  danger: 'transparent',
} as const;

export function Button({
  title,
  variant = 'primary',
  loading = false,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: BACKGROUND[variant], borderColor: BORDER[variant] },
        pressed && { backgroundColor: BACKGROUND_PRESSED[variant] },
        (disabled || loading) && styles.disabled,
        style,
      ]}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={FOREGROUND[variant]} />
      ) : (
        <Text style={[styles.label, { color: FOREGROUND[variant] }]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius.md,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    borderWidth: 1,
    ...Shadow.card,
  },
  label: {
    fontSize: 16,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.5,
  },
});
