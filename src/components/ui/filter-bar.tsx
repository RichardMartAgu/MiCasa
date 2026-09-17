import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { DateFilter, type DateFilterProps } from '@/components/ui/date-filter';
import { FilterChips, type FilterChipsProps } from '@/components/ui/filter-chips';
import { SearchBar } from '@/components/ui/search-bar';
import { Spacing } from '@/constants/theme';

export type FilterBarSearchProps = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
};

export type FilterBarChipsProps = FilterChipsProps;

export type FilterBarDateProps = DateFilterProps;

export type FilterBarProps = {
  search?: FilterBarSearchProps;
  chips?: FilterBarChipsProps;
  date?: FilterBarDateProps;
  style?: StyleProp<ViewStyle>;
};

export function FilterBar({ search, chips, date, style }: FilterBarProps) {
  return (
    <View style={[styles.container, style]}>
      {search ? <SearchBar {...search} /> : null}
      {chips ? <FilterChips {...chips} /> : null}
      {date ? <DateFilter {...date} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.three,
  },
});