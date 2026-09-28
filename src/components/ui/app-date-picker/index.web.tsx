import { createElement, type ChangeEvent } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Palette, Radius, Spacing } from '@/constants/theme';

export interface AppDatePickerProps {
  value: Date;
  mode: 'date' | 'time';
  onChange: (date: Date) => void;
  icon: string;
  formatValue: (date: Date) => string;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function toDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toTimeInputValue(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseDateInput(raw: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

export function parseTimeInput(raw: string, base: Date): Date | null {
  if (!/^\d{2}:\d{2}$/.test(raw)) return null;
  const [h, min] = raw.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  const next = new Date(base);
  next.setHours(h, min, 0, 0);
  return next;
}

/**
 * Picker de fecha/hora para web (resuelto por Metro en `--platform web`).
 * Botón con look Dusk; encima, input DOM oculto (`type="date"`/`type="time"`)
 * que abre el picker nativo del navegador. Sin react-dom: `createElement`.
 * Conversión local sin shift UTC: date `YYYY-MM-DD` → `new Date(y, m-1, d)`;
 * time `HH:mm` → copia horas/minutos sobre el `value` actual.
 */
export function AppDatePicker({
  value,
  mode,
  onChange,
  icon,
  formatValue,
  accessibilityLabel,
  style,
}: AppDatePickerProps) {
  const inputType = mode === 'date' ? 'date' : 'time';
  const inputValue = mode === 'date' ? toDateInputValue(value) : toTimeInputValue(value);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value;
    if (!raw) return;
    if (mode === 'date') {
      const parsed = parseDateInput(raw);
      if (parsed) onChange(parsed);
    } else {
      const parsed = parseTimeInput(raw, value);
      if (parsed) onChange(parsed);
    }
  }

  return (
    <View style={style}>
      <View
        style={styles.button}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        <Text style={styles.label}>
          {icon} {formatValue(value)}
        </Text>
      </View>
      {createElement('input', {
        type: inputType,
        value: inputValue,
        onChange: handleChange,
        'aria-label': accessibilityLabel,
        style: styles.hiddenInput,
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.md,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.two,
    alignItems: 'center',
    backgroundColor: Palette.surface,
  },
  label: { fontSize: 15, fontWeight: '600', color: Palette.textStrong },
  hiddenInput: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    opacity: 0,
    cursor: 'pointer',
  },
});