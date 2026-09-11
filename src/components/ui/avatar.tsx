import { Image, StyleSheet, Text, View } from 'react-native';

import { Palette } from '@/constants/theme';

const SIZES = { sm: 32, md: 40, lg: 56, xl: 80 } as const;
const FONT_SIZES = { sm: 12, md: 14, lg: 20, xl: 28 } as const;

export function Avatar({
  source,
  name,
  size = 'md',
  accessibilityLabel,
}: {
  source?: string;
  name?: string;
  size?: keyof typeof SIZES;
  accessibilityLabel?: string;
}) {
  const dimension = SIZES[size];
  const initials = name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  if (source) {
    return (
      <Image
        accessibilityLabel={accessibilityLabel ?? (name ?? undefined)}
        source={{ uri: source }}
        style={[styles.image, { width: dimension, height: dimension, borderRadius: dimension / 2 }]}
      />
    );
  }

  return (
    <View
      accessibilityLabel={accessibilityLabel ?? (name ?? undefined)}
      style={[
        styles.placeholder,
        { width: dimension, height: dimension, borderRadius: dimension / 2 },
      ]}>
      <Text style={[styles.initials, { fontSize: FONT_SIZES[size] }]}>{initials || '?'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    backgroundColor: Palette.surfaceMuted,
  },
  placeholder: {
    backgroundColor: Palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    color: Palette.onPrimary,
    fontWeight: '600',
  },
});