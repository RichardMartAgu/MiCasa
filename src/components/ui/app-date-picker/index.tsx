import { useState } from 'react';
import DateTimePicker, {
  DateTimePickerAndroid,
} from '@react-native-community/datetimepicker';
import {
  Platform,
  Pressable,
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

/**
 * Picker de fecha/hora transversal.
 * - Android: API imperativa `DateTimePickerAndroid.open` (evita bugs del API por
 *   componente en new arch, issues upstream #980/#994).
 * - iOS: picker inline `display="spinner"` que se alterna al pulsar el botón.
 * - Web: resuelto por `index.web.tsx` (input DOM nativo del navegador).
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
  const [showIOSPicker, setShowIOSPicker] = useState(false);

  function handlePress() {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value,
        mode,
        is24Hour: true,
        onChange: (event, selected) => {
          if (event.type === 'set' && selected) onChange(selected);
        },
      });
      return;
    }
    setShowIOSPicker((visible) => !visible);
  }

  return (
    <View style={style}>
      <Pressable
        style={styles.button}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={handlePress}>
        <Text style={styles.label}>
          {icon} {formatValue(value)}
        </Text>
      </Pressable>
      {Platform.OS === 'ios' && showIOSPicker ? (
        <DateTimePicker
          value={value}
          mode={mode}
          display="spinner"
          onChange={(event, selected) => {
            setShowIOSPicker(false);
            if (event.type === 'set' && selected) onChange(selected);
          }}
        />
      ) : null}
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
});