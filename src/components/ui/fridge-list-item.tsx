import { Ionicons } from '@expo/vector-icons';
import { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Palette, Radius, Spacing } from '@/constants/theme';

export function FridgeListItem({
  name,
  expiry,
  onPress,
}: {
  name: string;
  expiry: string;
  onPress?: () => void;
}) {
  const isExpired = new Date(expiry) < new Date();

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!!onPress && !isExpired}
      onPress={onPress}
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}>
      <View style={styles.container}>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.expiry}>{expiry}</Text>
      </View>
      {onPress ? (
        <Ionicons name="chevron-forward" size={20} color={Palette.textMuted} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    backgroundColor: Palette.surface,
    borderRadius: Radius.md,
  },
  pressed: {
    opacity: 0.7,
  },
  name: {
    fontSize: 15,
    color: Palette.text,
  },
  expiry: {
    fontSize: 13,
    color: Palette.textMuted,
    marginLeft: Spacing.one,
  },
});