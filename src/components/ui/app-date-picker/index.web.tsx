import {
  createElement,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Button } from '@/components/ui/button';
import { Palette, Radius, Shadow, Spacing } from '@/constants/theme';

export interface AppDatePickerProps {
  value: Date;
  mode: 'date' | 'time';
  onChange: (date: Date) => void;
  icon: string;
  formatValue: (date: Date) => string;
  accessibilityLabel: string;
  min?: Date;
  max?: Date;
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

const MONTHS = [
  'Ene',
  'Feb',
  'Mar',
  'Abr',
  'May',
  'Jun',
  'Jul',
  'Ago',
  'Sep',
  'Oct',
  'Nov',
  'Dic',
];

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

function clampDate(date: Date, min?: Date, max?: Date): Date {
  let time = date.getTime();
  if (min) time = Math.max(time, min.getTime());
  if (max) time = Math.min(time, max.getTime());
  return new Date(time);
}

/**
 * Picker web propio, sin `<input type="date">` ni `<input type="time">`.
 *
 * Safari iOS no abre el picker nativo cuando React delega los eventos de click
 * en un ancestro (bug de WebKit 294649), y `showPicker()` no está implementado
 * en iOS. Por eso el control real son `<select>` nativos dentro de un modal:
 * funcionan con teclado, lector de pantalla y táctil en todos los navegadores.
 */
export function AppDatePicker({
  value,
  mode,
  onChange,
  icon,
  formatValue,
  accessibilityLabel,
  min,
  max,
  style,
}: AppDatePickerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);

  const year = draft.getFullYear();
  const month = draft.getMonth();
  const day = draft.getDate();
  const hour = draft.getHours();
  const minute = draft.getMinutes();
  const maxDay = daysInMonth(year, month);
  const currentYear = new Date().getFullYear();
  const firstYear = min?.getFullYear() ?? 1900;
  const lastYear = max?.getFullYear() ?? Math.max(currentYear + 10, year);
  const years = range(Math.min(firstYear, year), Math.max(firstYear, lastYear, year));

  function openPicker() {
    setDraft(value);
    setDirty(false);
    setOpen(true);
  }

  function closePicker() {
    setOpen(false);
  }

  function confirm() {
    // Abrir y pulsar Listo no debe mover una fecha ya guardada, aunque esté
    // fuera del rango actual (p. ej. un producto caducado).
    if (dirty && draft.getTime() !== value.getTime()) {
      const clamped = clampDate(draft, min, max);
      if (clamped.getTime() !== value.getTime()) onChange(clamped);
    }
    setOpen(false);
  }

  function setDatePart(nextYear: number, nextMonth: number, nextDay: number) {
    const next = new Date(draft);
    next.setFullYear(nextYear, nextMonth, Math.min(nextDay, daysInMonth(nextYear, nextMonth)));
    setDraft(next);
    setDirty(true);
  }

  function setTimePart(nextHour: number, nextMinute: number) {
    const next = new Date(draft);
    next.setHours(nextHour, nextMinute, 0, 0);
    setDraft(next);
    setDirty(true);
  }

  return (
    <View style={style}>
      <Pressable
        style={styles.button}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={openPicker}>
        <Text style={styles.label}>
          {icon} {formatValue(value)}
        </Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={closePicker}
        accessibilityLabel={mode === 'date' ? 'Elegir fecha' : 'Elegir hora'}
        accessibilityViewIsModal>
        <View style={styles.overlay}>
          <View style={styles.card}>
            <Text style={styles.title} accessibilityRole="header">
              {mode === 'date' ? 'Elegir fecha' : 'Elegir hora'}
            </Text>

            {mode === 'date' ? (
              <View style={styles.selectRow}>
                <SelectField
                  label="Día"
                  value={String(day)}
                  options={range(1, maxDay).map((n) => ({ value: String(n), label: String(n) }))}
                  onChange={(raw) => setDatePart(year, month, Number(raw))}
                />
                <SelectField
                  label="Mes"
                  value={String(month)}
                  options={MONTHS.map((name, index) => ({
                    value: String(index),
                    label: name,
                  }))}
                  onChange={(raw) => setDatePart(year, Number(raw), day)}
                />
                <SelectField
                  label="Año"
                  value={String(year)}
                  options={years.map((n) => ({ value: String(n), label: String(n) }))}
                  onChange={(raw) => setDatePart(Number(raw), month, day)}
                />
              </View>
            ) : (
              <View style={styles.selectRow}>
                <SelectField
                  label="Hora"
                  value={String(hour)}
                  options={range(0, 23).map((n) => ({
                    value: String(n),
                    label: pad(n),
                  }))}
                  onChange={(raw) => setTimePart(Number(raw), minute)}
                />
                <SelectField
                  label="Minuto"
                  value={String(minute)}
                  options={range(0, 59).map((n) => ({
                    value: String(n),
                    label: pad(n),
                  }))}
                  onChange={(raw) => setTimePart(hour, Number(raw))}
                />
              </View>
            )}

            <Text style={styles.preview}>{formatValue(draft)}</Text>

            <View style={styles.actions}>
              <Button title="Cancelar" variant="secondary" onPress={closePicker} />
              <Button title="Listo" onPress={confirm} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

interface SelectOption {
  value: string;
  label: string;
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.selectField}>
      <Text style={styles.selectLabel}>{label}</Text>
      {createElement(
        'select',
        {
          value,
          'aria-label': label,
          onChange: (event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value),
          style: selectStyle,
        },
        options.map((option) =>
          createElement('option', { key: option.value, value: option.value }, option.label),
        ),
      )}
    </View>
  );
}

const selectStyle: CSSProperties = {
  width: '100%',
  minWidth: 0,
  margin: 0,
  padding: '12px 8px',
  border: `1px solid ${Palette.border}`,
  borderRadius: Radius.md,
  background: Palette.surface,
  color: Palette.textStrong,
  fontSize: 16,
  fontWeight: 600,
  textAlign: 'center',
  cursor: 'pointer',
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
  label: { fontSize: 15, fontWeight: '600', color: Palette.textStrong },
  overlay: {
    flex: 1,
    backgroundColor: Palette.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: Palette.background,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.border,
    padding: Spacing.four,
    gap: Spacing.three,
    ...Shadow.card,
  },
  title: { fontSize: 20, fontWeight: '800', color: Palette.text },
  selectRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-end' },
  selectField: { flex: 1, minWidth: 0, gap: Spacing.one },
  selectLabel: { fontSize: 12, fontWeight: '700', color: Palette.textSecondary },
  preview: {
    fontSize: 15,
    fontWeight: '700',
    color: Palette.primary,
    textAlign: 'center',
  },
  actions: { flexDirection: 'row', gap: Spacing.three },
});
