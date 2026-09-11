import { StyleSheet, View, type ViewProps } from 'react-native';

import { Palette, Radius, Shadow, Spacing } from '@/constants/theme';

export function Card({ style, ...rest }: ViewProps) {
  return <View style={[styles.card, style]} {...rest} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Palette.surface,
    borderRadius: Radius.xl,
    padding: Spacing.four,
    borderWidth: 1,
    borderColor: Palette.border,
    gap: Spacing.two,
    ...Shadow.card,
  },
});
