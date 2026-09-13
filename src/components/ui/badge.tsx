import { StyleSheet, Text, View } from 'react-native';

import { Palette, Radius } from '@/constants/theme';

const COLORS = {
  primary: { bg: Palette.primarySoft, fg: '#93C5FD' },
  success: { bg: Palette.successSoft, fg: '#6EE7B7' },
  warning: { bg: Palette.warningSoft, fg: '#FCD34D' },
  danger: { bg: Palette.dangerSoft, fg: '#FCA5A5' },
  gray: { bg: Palette.surfaceMuted, fg: '#CBD5E1' },
} as const;

export function Badge({
  label,
  color = 'primary',
}: {
  label: string;
  color?: keyof typeof COLORS;
}) {
  return (
    <View style={[styles.container, { backgroundColor: COLORS[color].bg }]}>
      <Text style={[styles.label, { color: COLORS[color].fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    alignSelf: 'flex-start',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
});