import { render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { Card } from '@/components/ui/card';

describe('Card', () => {
  it('renderiza children', () => {
    const { getByText } = render(
      <Card>
        <Text>Contenido</Text>
      </Card>,
    );
    expect(getByText('Contenido')).toBeTruthy();
  });

  it('propaga props extra', () => {
    const { getByTestId } = render(
      <Card testID="card" accessibilityLabel="tarjeta">
        <Text>X</Text>
      </Card>,
    );
    expect(getByTestId('card').props.accessibilityLabel).toBe('tarjeta');
  });
});