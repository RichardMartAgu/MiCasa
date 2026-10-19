import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Palette, Radius, Spacing } from '@/constants/theme';
import { fridgeDaysLeft, fridgeExpiryLabel } from '@/lib/fridge';
import type { FridgeItem } from '@/lib/types';

function expiryColor(days: number | null): string {
  if (days === null) return Palette.textMuted;
  if (days <= 0) return Palette.danger;
  if (days === 1) return Palette.warning;
  return Palette.textMuted;
}

export function FridgeListItem({
  item,
  onToggle,
  onPress,
  onDelete,
}: {
  item: FridgeItem;
  onToggle?: () => void;
  onPress?: () => void;
  onDelete?: () => void;
}) {
  const days = fridgeDaysLeft(item.expiry_date);
  const amount =
    item.quantity !== null && item.quantity !== undefined
      ? `${item.quantity}${item.unit ? ` ${item.unit}` : ''}`
      : item.unit ?? '';

  return (
    <View style={[styles.card, item.done && styles.cardDone]}>
      <Pressable
        onPress={onToggle}
        hitSlop={14}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.done }}
        accessibilityLabel={`Marcar ${item.name} como consumido`}>
        <Ionicons
          name={item.done ? 'checkbox' : 'square-outline'}
          size={22}
          color={item.done ? Palette.success : Palette.textMuted}
        />
      </Pressable>
      <Pressable
        style={styles.body}
        accessibilityRole="button"
        accessibilityLabel={`Editar ${item.name}`}
        onPress={onPress}>
        <Text style={[styles.name, item.done && styles.done]}>{item.name}</Text>
        <View style={styles.metaRow}>
          {amount ? <Text style={styles.amount}>{amount}</Text> : null}
          <Text style={[styles.expiry, { color: expiryColor(days) }]}>
            {fridgeExpiryLabel(item.expiry_date)}
          </Text>
        </View>
      </Pressable>
      <Pressable
        onPress={onDelete}
        hitSlop={14}
        accessibilityRole="button"
        accessibilityLabel={`Eliminar ${item.name}`}>
        <Ionicons name="trash-outline" size={20} color={Palette.danger} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    backgroundColor: Palette.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  cardDone: { opacity: 0.6 },
  body: { flex: 1, gap: Spacing.one },
  name: { fontSize: 15, fontWeight: '600', color: Palette.textStrong },
  done: { textDecorationLine: 'line-through', color: Palette.textMuted },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, alignItems: 'center' },
  amount: { fontSize: 13, color: Palette.textSecondary },
  expiry: { fontSize: 13, fontWeight: '600' },
});
