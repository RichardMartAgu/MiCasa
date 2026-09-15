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
  variant?: 'primary' | 'secondary' | 'danger' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
};

const BACKGROUND = {
  primary: Palette.primary,
  secondary: Palette.surface,
  danger: Palette.danger,
  outline: 'transparent',
  ghost: 'transparent',
} as const;

const BACKGROUND_PRESSED = {
  primary: Palette.primaryPressed,
  secondary: Palette.surfacePressed,
  danger: Palette.dangerPressed,
  outline: Palette.primarySoft,
  ghost: Palette.primarySoft,
} as const;

const FOREGROUND = {
  primary: Palette.onPrimary,
  secondary: Palette.textStrong,
  danger: Palette.onPrimary,
  outline: Palette.primary,
  ghost: Palette.primary,
} as const;

const BORDER = {
  primary: 'transparent',
  secondary: Palette.border,
  danger: 'transparent',
  outline: Palette.primary,
  ghost: 'transparent',
} as const;

const PADDING = {
  sm: Spacing.three - Spacing.two,
  md: Spacing.three,
  lg: Spacing.four,
} as const;

const FONT_SIZE = {
  sm: 14,
  md: 16,
  lg: 18,
} as const;

const MIN_HEIGHT = {
  sm: 44,
  md: 52,
  lg: 60,
} as const;

export function Button({
  title,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: BACKGROUND[variant],
          borderColor: BORDER[variant],
          paddingVertical: PADDING[size],
          paddingHorizontal: PADDING[size] + Spacing.one,
          minHeight: MIN_HEIGHT[size],
        },
        pressed && { backgroundColor: BACKGROUND_PRESSED[variant] },
        (disabled || loading) && styles.disabled,
        style,
      ]}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={FOREGROUND[variant]} />
      ) : (
        <Text style={[styles.label, { color: FOREGROUND[variant], fontSize: FONT_SIZE[size] }]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    ...Shadow.card,
  },
  label: {
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.5,
  },
});
