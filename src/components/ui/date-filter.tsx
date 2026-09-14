import { FilterChips } from '@/components/ui/filter-chips';

export type DateFilterOption = {
  label: string;
  value: string;
};

export type DateFilterProps = {
  options?: DateFilterOption[];
  selected: string;
  onSelect: (value: string) => void;
};

const DEFAULT_OPTIONS: DateFilterOption[] = [
  { label: 'Este mes', value: 'this_month' },
  { label: 'Este año', value: 'this_year' },
  { label: 'Últimos 3 meses', value: 'last_3_months' },
  { label: 'Todo', value: 'all' },
];

export function DateFilter({ options = DEFAULT_OPTIONS, selected, onSelect }: DateFilterProps) {
  return (
    <FilterChips
      options={options}
      selected={selected}
      onSelect={(value) => {
        if (typeof value === 'string') onSelect(value);
      }}
    />
  );
}