import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Palette, Radius, Spacing } from '@/constants/theme';
import { FridgeListItem } from './fridge-list-item';

export function FridgeList({
  items,
  onPress,
  hasEmpty,
}: {
  items: { name: string; expiry: string }[];
  onPress?: (name: string) => void;
  hasEmpty?: boolean;
}) {
  if (hasEmpty || items.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No hay elementos en la nevera</Text>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.list}
      showsVerticalScrollIndicator={false}
    >
      {items.map((item) => (
        <FridgeListItem
          key={item.name}
          name={item.name}
          expiry={item.expiry}
          onPress={() => onPress?.(item.name)}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: Spacing.two,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  emptyText: {
    color: Palette.textMuted,
    fontSize: 15,
  },
});