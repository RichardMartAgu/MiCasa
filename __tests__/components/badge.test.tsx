import { render } from '@testing-library/react-native';

import { Badge } from '@/components/ui/badge';

describe('Badge', () => {
  it('renderiza el label', () => {
    const { getByText } = render(<Badge label="Pagado" />);
    expect(getByText('Pagado')).toBeTruthy();
  });

  it('renderiza variante success', () => {
    const { getByText } = render(<Badge label="Pagado" color="success" />);
    expect(getByText('Pagado')).toBeTruthy();
  });

  it('renderiza variante danger', () => {
    const { getByText } = render(<Badge label="Vencido" color="danger" />);
    expect(getByText('Vencido')).toBeTruthy();
  });
});