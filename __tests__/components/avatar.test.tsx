import { render } from '@testing-library/react-native';

import { Avatar } from '@/components/ui/avatar';

describe('Avatar', () => {
  it('muestra iniciales del nombre', () => {
    const { getByText } = render(<Avatar name="Ana García" />);
    expect(getByText('AG')).toBeTruthy();
  });

  it('muestra fallback cuando no hay nombre', () => {
    const { getByText } = render(<Avatar />);
    expect(getByText('?')).toBeTruthy();
  });

  it('renderiza imagen cuando hay source', () => {
    const { getByLabelText } = render(
      <Avatar source="https://example.com/avatar.png" name="Ana" accessibilityLabel="avatar" />,
    );
    expect(getByLabelText('avatar')).toBeTruthy();
  });
});