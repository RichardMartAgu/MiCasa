import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Platform, Share } from 'react-native';

import { InviteCode } from '@/components/ui/invite-code';

const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');

function setNavigator(value: unknown) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value,
  });
}

describe('InviteCode', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
    } else {
      delete (globalThis as { navigator?: unknown }).navigator;
    }
    if (originalDocumentDescriptor) {
      Object.defineProperty(globalThis, 'document', originalDocumentDescriptor);
    } else {
      delete (globalThis as { document?: unknown }).document;
    }
  });

  it('muestra el código completo', () => {
    const { getByText } = render(<InviteCode code="ABC12345" />);
    expect(getByText('ABC12345')).toBeTruthy();
  });

  it('en nativo comparte con Share y no ofrece copiar', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.dismissedAction });
    const { getByLabelText, queryByLabelText } = render(<InviteCode code="ABC12345" />);

    expect(queryByLabelText('Copiar código de invitación')).toBeNull();
    fireEvent.press(getByLabelText('Compartir código de invitación'));

    expect(share).toHaveBeenCalledWith({
      message: 'Únete a mi casa en MiCasa con el código ABC12345',
    });
  });

  it('en nativo cancelar el share no rompe ni muestra copiado', async () => {
    jest.spyOn(Share, 'share').mockRejectedValue(new Error('User did not share'));
    const { getByLabelText, queryByText } = render(<InviteCode code="ABC12345" />);

    await act(async () => {
      fireEvent.press(getByLabelText('Compartir código de invitación'));
    });

    expect(queryByText('Copiado')).toBeNull();
  });

  it('en web copia al portapapeles y muestra confirmación', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const writeText = jest.fn().mockResolvedValue(undefined);
    setNavigator({ clipboard: { writeText } });

    const { getByLabelText, getAllByText } = render(<InviteCode code="ABC12345" />);
    fireEvent.press(getByLabelText('Copiar código de invitación'));

    expect(writeText).toHaveBeenCalledWith('ABC12345');
    await waitFor(() => expect(getAllByText('Copiado').length).toBeGreaterThan(0));
  });

  it('en web comparte con navigator.share si existe', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const shareFn = jest.fn().mockResolvedValue(undefined);
    const writeText = jest.fn().mockResolvedValue(undefined);
    setNavigator({ share: shareFn, clipboard: { writeText } });

    const { getByLabelText } = render(<InviteCode code="ABC12345" />);
    await act(async () => {
      fireEvent.press(getByLabelText('Compartir código de invitación'));
    });

    expect(shareFn).toHaveBeenCalledWith({
      title: 'MiCasa',
      text: 'Únete a mi casa en MiCasa con el código ABC12345',
    });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('en web cancelar navigator.share no rompe ni copia', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const shareFn = jest.fn().mockRejectedValue(new Error('AbortError'));
    const writeText = jest.fn().mockResolvedValue(undefined);
    setNavigator({ share: shareFn, clipboard: { writeText } });

    const { getByLabelText, queryByText } = render(<InviteCode code="ABC12345" />);
    await act(async () => {
      fireEvent.press(getByLabelText('Compartir código de invitación'));
    });

    expect(writeText).not.toHaveBeenCalled();
    expect(queryByText('Copiado')).toBeNull();
  });

  it('no ofrece botones en web sin clipboard ni share', () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    setNavigator({});

    const { queryByLabelText } = render(<InviteCode code="ABC12345" />);

    expect(queryByLabelText('Copiar código de invitación')).toBeNull();
    expect(queryByLabelText('Compartir código de invitación')).toBeNull();
  });

  it('limpia el timer de "Copiado" al desmontar', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    jest.useFakeTimers();
    const writeText = jest.fn().mockResolvedValue(undefined);
    setNavigator({ clipboard: { writeText } });
    const clearSpy = jest.spyOn(globalThis, 'clearTimeout');

    const { getByLabelText, unmount } = render(<InviteCode code="ABC12345" />);
    fireEvent.press(getByLabelText('Copiar código de invitación'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    clearSpy.mockClear();
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });

  it('en web avisa si la copia falla y no hay fallback', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const writeText = jest.fn().mockRejectedValue(new Error('NotAllowedError'));
    setNavigator({ clipboard: { writeText } });

    const { getByLabelText, getAllByText, queryByLabelText } = render(
      <InviteCode code="ABC12345" />,
    );
    fireEvent.press(getByLabelText('Copiar código de invitación'));

    await waitFor(() => expect(getAllByText('No se pudo copiar').length).toBeGreaterThan(0));
    expect(getByLabelText('No se pudo copiar el código')).toBeTruthy();
    expect(queryByLabelText('Copiar código de invitación')).toBeNull();
  });

  it('en web usa execCommand si no existe Clipboard API', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const execCommand = jest.fn().mockReturnValue(true);
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        execCommand,
        createElement: () => ({ style: {}, setAttribute: jest.fn(), select: jest.fn() }),
        body: { appendChild: jest.fn(), removeChild: jest.fn() },
      },
    });
    setNavigator({});

    const { getByLabelText, getAllByText } = render(<InviteCode code="ABC12345" />);
    fireEvent.press(getByLabelText('Copiar código de invitación'));

    expect(execCommand).toHaveBeenCalledWith('copy');
    await waitFor(() => expect(getAllByText('Copiado').length).toBeGreaterThan(0));
  });

  it('sigue funcionando tras un remontaje (StrictMode)', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const writeText = jest.fn().mockResolvedValue(undefined);
    setNavigator({ clipboard: { writeText } });

    const first = render(<InviteCode code="ABC12345" />);
    first.unmount();
    const { getByLabelText, getAllByText } = render(<InviteCode code="ABC12345" />);
    fireEvent.press(getByLabelText('Copiar código de invitación'));

    await waitFor(() => expect(getAllByText('Copiado').length).toBeGreaterThan(0));
  });

  it('compact usa solo iconos pero mantiene etiquetas accesibles', () => {
    const { getByLabelText, queryByText } = render(<InviteCode code="ABC12345" compact />);

    expect(getByLabelText('Compartir código de invitación')).toBeTruthy();
    expect(queryByText('Compartir')).toBeNull();
  });
});
