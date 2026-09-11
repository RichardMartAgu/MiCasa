import { render } from '@testing-library/react-native';

import { EmptyState } from '@/components/ui/empty-state';

describe('EmptyState', () => {
  it('renderiza título y subtítulo', () => {
    const { getByText } = render(
      <EmptyState title="Sin gastos" subtitle="Apunta tus compras." />,
    );
    expect(getByText('Sin gastos')).toBeTruthy();
    expect(getByText('Apunta tus compras.')).toBeTruthy();
  });

  it('omite subtítulo cuando no se pasa', () => {
    const { queryByText } = render(<EmptyState title="Sin gastos" />);
    expect(queryByText('Apunta tus compras.')).toBeNull();
  });
});