import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { Palette, Radius, Spacing } from '@/constants/theme';

export type FilterChipOption = {
  label: string;
  value: string;
  color?: string;
};

export type FilterChipsProps = {
  options: FilterChipOption[];
  selected: string | string[];
  onSelect: (value: string | string[]) => void;
  multiple?: boolean;
};

export function FilterChips({ options, selected, onSelect, multiple = false }: FilterChipsProps) {
  const isSelected = (value: string) =>
    Array.isArray(selected) ? selected.includes(value) : selected === value;

  const handlePress = (value: string) => {
    if (multiple) {
      const current = Array.isArray(selected) ? selected : [];
      const next = current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value];
      onSelect(next);
    } else {
      onSelect(selected === value ? '' : value);
    }
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}>
      {options.map((option) => {
        const selectedChip = isSelected(option.value);
        const chipColor = option.color ?? Palette.primary;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: selectedChip }}
            onPress={() => handlePress(option.value)}
            style={({ pressed }) => [
              styles.chip,
              selectedChip
                ? { backgroundColor: chipColor, borderColor: chipColor }
                : styles.chipUnselected,
              pressed && styles.chipPressed,
            ]}>
            <Text
              style={[
                styles.label,
                selectedChip ? styles.labelSelected : styles.labelUnselected,
              ]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.two,
  },
  chip: {
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderWidth: 1,
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
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
  labelSelected: {
    color: Palette.onPrimary,
  },
  labelUnselected: {
    color: Palette.textSecondary,
  },
});