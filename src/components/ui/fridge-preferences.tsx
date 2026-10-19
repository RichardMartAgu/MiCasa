import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Palette, Radius, Spacing } from '@/constants/theme';

export type FridgeChoice = 'none' | 'day-before' | 'same-day' | 'both';

export type FridgeChoiceItem = {
  label: string;
  value: FridgeChoice;
};

export function FridgePreferences({
  value,
  onChange,
}: {
  value: FridgeChoice;
  onChange: (choice: FridgeChoice) => void;
}) {
  const items: FridgeChoiceItem[] = [
    { label: 'Ningún aviso', value: 'none' },
    { label: '1 día antes', value: 'day-before' },
    { label: 'Mismo día', value: 'same-day' },
    { label: 'Ambos', value: 'both' },
  ];

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>Aviso de expiración</Text>
      <View style={styles.chipsWrap}>      
        {items.map((item) => (
          <Pressable
            key={item.value}
            accessibilityRole="button"
            accessibilityState={{ selected: value === item.value }}
            onPress={() => onChange(item.value)}
            style={({ pressed }) => [
              styles.chip,
              value === item.value ? { backgroundColor: Palette.primary, borderColor: Palette.primary } : styles.chipUnselected,
              pressed && styles.chipPressed,
            ]}>
            <Text style={[
              styles.labelChip,
              value === item.value ? styles.labelChipSelected : styles.labelChipUnselected,
            ]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    padding: Spacing.three,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.md,
    backgroundColor: Palette.surface,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: Palette.textStrong,
    marginBottom: Spacing.two,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderWidth: 1,
    borderColor: Palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipUnselected: {
    backgroundColor: Palette.surface,
    borderColor: Palette.borderStrong,
  },
  chipPressed: {
    opacity: 0.75,
  },
  labelChip: {
    fontSize: 13,
  },
  labelChipSelected: {
    color: Palette.onPrimary,
    fontSize: 13,
  },
  labelChipUnselected: {
    color: Palette.textSecondary,
    fontSize: 13,
  },
});