import { fireEvent, render } from '@testing-library/react-native';

import { IconButton } from '@/components/ui/icon-button';

describe('IconButton', () => {
  it('renderiza el icono', () => {
    const { getByRole } = render(<IconButton name="add" onPress={jest.fn()} />);
    expect(getByRole('button')).toBeTruthy();
  });

  it('llama onPress al pulsar', () => {
    const onPress = jest.fn();
    const { getByRole } = render(<IconButton name="add" onPress={onPress} />);

    fireEvent.press(getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('expone testID', () => {
    const { getByTestId } = render(
      <IconButton name="add" onPress={jest.fn()} testID="add-button" />,
    );
    expect(getByTestId('add-button')).toBeTruthy();
  });
});