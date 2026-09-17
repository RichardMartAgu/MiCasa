import { ActivityIndicator, StyleSheet, View, type ViewStyle, type StyleProp } from 'react-native';

import { Palette } from '@/constants/theme';

type SpinnerSize = 'small' | 'large';

interface SpinnerProps {
  size?: SpinnerSize;
  color?: string;
  fullScreen?: boolean;
  style?: StyleProp<ViewStyle>;
}

const SIZE_MAP = {
  small: 20,
  large: 36,
} as const;

export function Spinner({
  size = 'large',
  color = Palette.primary,
  fullScreen = false,
  style,
}: SpinnerProps) {
  const spinner = <ActivityIndicator size={SIZE_MAP[size]} color={color} />;

  if (!fullScreen) return spinner;

  return (
    <View
      style={[styles.fullScreen, style]}
      accessibilityRole="progressbar"
      accessibilityLabel="Cargando">
      {spinner}
    </View>
  );
}

const styles = StyleSheet.create({
  fullScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.bg,
  },
});
