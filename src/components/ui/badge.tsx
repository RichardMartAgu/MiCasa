import { StyleSheet, Text, View } from 'react-native';

import { Palette, Radius } from '@/constants/theme';

const COLORS = {
  primary: { bg: Palette.primarySoft, fg: '#4338ca' },
  success: { bg: Palette.successSoft, fg: '#047857' },
  warning: { bg: Palette.warningSoft, fg: '#b45309' },
  danger: { bg: Palette.dangerSoft, fg: '#b91c1c' },
  gray: { bg: Palette.surfaceMuted, fg: '#475569' },
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