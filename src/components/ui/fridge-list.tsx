import { StyleSheet, Text, View } from 'react-native';

import { Palette, Spacing } from '@/constants/theme';
import type { FridgeItem } from '@/lib/types';
import { FridgeListItem } from './fridge-list-item';

export function FridgeList({
  items,
  onToggle,
  onPress,
  onDelete,
}: {
  items: FridgeItem[];
  onToggle?: (item: FridgeItem) => void;
  onPress?: (item: FridgeItem) => void;
  onDelete?: (item: FridgeItem) => void;
}) {
  if (items.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No hay elementos en la nevera</Text>
      </View>
    );
  }

  return (
    <View style={styles.list}>
      {items.map((item) => (
        <FridgeListItem
          key={item.id}
          item={item}
          onToggle={() => onToggle?.(item)}
          onPress={() => onPress?.(item)}
          onDelete={() => onDelete?.(item)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: Spacing.two,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  emptyText: {
    color: Palette.textMuted,
    fontSize: 15,
  },
});
