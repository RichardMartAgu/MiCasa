import { useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Palette, Radius, Spacing } from '@/constants/theme';

type GlyphName = keyof typeof Ionicons.glyphMap;

function isWeb(): boolean {
  return Platform.OS === 'web';
}

type WebKeyEvent = { nativeEvent: { key: string }; preventDefault?: () => void };
type WebKeyProps = { onKeyDown?: (event: WebKeyEvent) => void };

export interface IconPickerOption<T extends GlyphName = GlyphName> {
  icon: T;
  label: string;
}

interface IconPickerProps<T extends GlyphName> {
  label: string;
  value: T;
  options: readonly IconPickerOption<T>[];
  onChange: (icon: T) => void;
}

const ARROW_KEYS: readonly string[] = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'];

export function nextIconIndex(current: number, delta: number, total: number): number {
  if (total <= 0) return -1;
  const start = current >= 0 && current < total ? current : 0;
  return (((start + delta) % total) + total) % total;
}

export function IconPicker<T extends GlyphName>({
  label,
  value,
  options,
  onChange,
}: IconPickerProps<T>) {
  const [focusedIcon, setFocusedIcon] = useState<T | null>(null);
  const nodes = useRef<Partial<Record<T, View | null>>>({});
  const web = isWeb();
  const selectedIndex = options.findIndex((option) => option.icon === value);
  const activeIndex = selectedIndex >= 0 ? selectedIndex : 0;

  function handleKeyDown(event: WebKeyEvent, index: number) {
    const key = event.nativeEvent.key;
    if (!ARROW_KEYS.includes(key)) return;
    event.preventDefault?.();
    const delta = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1;
    const nextOption = options[nextIconIndex(index, delta, options.length)];
    onChange(nextOption.icon);
    nodes.current[nextOption.icon]?.focus();
  }

  return (
    <View style={styles.container} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.grid}>
        {options.map((option, index) => {
          const selected = option.icon === value;
          const focused = web && focusedIcon === option.icon;
          const webKeyProps: WebKeyProps = web
            ? { onKeyDown: (event) => handleKeyDown(event, index) }
            : {};
          return (
            <Pressable
              key={option.icon}
              ref={(node) => {
                nodes.current[option.icon] = node;
              }}
              style={[
                styles.option,
                selected && styles.optionSelected,
                focused && styles.optionFocused,
              ]}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ checked: selected }}
              focusable={web}
              tabIndex={index === activeIndex ? 0 : -1}
              onPress={() => onChange(option.icon)}
              onFocus={() => setFocusedIcon(option.icon)}
              onBlur={() => setFocusedIcon(null)}
              {...webKeyProps}>
              <Ionicons
                name={option.icon}
                size={22}
                color={selected ? Palette.onPrimary : Palette.textStrong}
              />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.two },
  label: { fontSize: 14, fontWeight: '600', color: Palette.textStrong },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  option: {
    width: 48,
    height: 48,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionSelected: { backgroundColor: Palette.primary, borderColor: Palette.primary },
  optionFocused: { borderColor: Palette.onPrimary, borderWidth: 2 },
});
