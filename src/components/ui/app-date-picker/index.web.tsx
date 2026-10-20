import {
  createElement,
  useInsertionEffect,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type FocusEvent,
} from 'react';
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
 * Botón con look Dusk; encima, un input DOM real (`type="date"`/`type="time"`)
 * que abre el picker nativo del navegador. Sin react-dom: `createElement`.
 * Conversión local sin shift UTC: date `YYYY-MM-DD` → `new Date(y, m-1, d)`;
 * time `HH:mm` → copia horas/minutos sobre el `value` actual.
 *
 * El input no se oculta con `opacity: 0`: Safari iOS puede no abrir el picker de
 * un control que considera invisible. Se deja visible encima del botón, con el
 * texto nativo oculto por CSS, para que el área táctil sea la del propio input.
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
  useDatePickerStyles();
  const [focused, setFocused] = useState(false);
  const inputType = mode === 'date' ? 'date' : 'time';
  const inputValue = mode === 'date' ? toDateInputValue(value) : toTimeInputValue(value);

  function commit(raw: string) {
    if (!raw) return;
    if (mode === 'date') {
      const parsed = parseDateInput(raw);
      if (parsed && toDateInputValue(parsed) !== inputValue) onChange(parsed);
    } else {
      const parsed = parseTimeInput(raw, value);
      if (parsed && parsed.getTime() !== value.getTime()) onChange(parsed);
    }
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    commit(event.target.value);
  }

  function handleBlur(event: FocusEvent<HTMLInputElement>) {
    setFocused(false);
    commit(event.target.value);
  }

  return (
    <View style={style}>
      <View
        style={[styles.button, focused && styles.buttonFocused]}
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
        onFocus: () => setFocused(true),
        onBlur: handleBlur,
        'aria-label': accessibilityLabel,
        'data-micasa-date-picker': 'true',
        style: inputStyle,
      })}
    </View>
  );
}

const DATE_PICKER_STYLE_ID = 'micasa-date-picker-input-styles';

const DATE_PICKER_CSS = `
input[data-micasa-date-picker]::-webkit-datetime-edit,
input[data-micasa-date-picker]::-webkit-datetime-edit-fields-wrapper,
input[data-micasa-date-picker]::-webkit-datetime-edit-text,
input[data-micasa-date-picker]::-webkit-datetime-edit-month-field,
input[data-micasa-date-picker]::-webkit-datetime-edit-day-field,
input[data-micasa-date-picker]::-webkit-datetime-edit-year-field,
input[data-micasa-date-picker]::-webkit-datetime-edit-hour-field,
input[data-micasa-date-picker]::-webkit-datetime-edit-minute-field,
input[data-micasa-date-picker]::-webkit-datetime-edit-ampm-field {
  color: transparent;
}
input[data-micasa-date-picker]::-webkit-calendar-picker-indicator {
  opacity: 0;
}
input[data-micasa-date-picker]:focus-visible {
  outline: 2px solid ${Palette.primary} !important;
  outline-offset: 2px;
}
`;

function useDatePickerStyles() {
  useInsertionEffect(() => {
    if (typeof document === 'undefined' || document.getElementById(DATE_PICKER_STYLE_ID)) {
      return;
    }
    const style = document.createElement('style');
    style.id = DATE_PICKER_STYLE_ID;
    style.textContent = DATE_PICKER_CSS;
    document.head.appendChild(style);
  }, []);
}

const inputStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: '100%',
  height: '100%',
  margin: 0,
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: 'transparent',
  caretColor: 'transparent',
  WebkitTextFillColor: 'transparent',
  fontSize: 16,
  outline: 'none',
  cursor: 'pointer',
  appearance: 'none',
  WebkitAppearance: 'none',
  zIndex: 1,
};

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
  buttonFocused: { borderColor: Palette.primary },
  label: { fontSize: 15, fontWeight: '600', color: Palette.textStrong },
});
