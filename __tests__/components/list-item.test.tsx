import { fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { ListItem } from '@/components/ui/list-item';

describe('ListItem', () => {
  it('renderiza título y subtítulo', () => {
    const { getByText } = render(<ListItem title="Casa" subtitle="4 miembros" />);
    expect(getByText('Casa')).toBeTruthy();
    expect(getByText('4 miembros')).toBeTruthy();
  });

  it('llama onPress al pulsar', () => {
    const onPress = jest.fn();
    const { getByText } = render(<ListItem title="Casa" onPress={onPress} />);

    fireEvent.press(getByText('Casa'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renderiza right content', () => {
    const { getByText } = render(
      <ListItem title="Casa" right={<Text>🟢</Text>} showChevron={false} />,
    );
    expect(getByText('🟢')).toBeTruthy();
  });
});