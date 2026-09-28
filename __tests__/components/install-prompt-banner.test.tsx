import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { InstallPromptBanner } from '@/components/install-prompt-banner';
import { useAppInstall, type AppInstall } from '@/hooks/use-app-install';
import { showNotice } from '@/lib/notice';

jest.mock('@/hooks/use-app-install', () => ({ useAppInstall: jest.fn() }));
jest.mock('@/lib/notice', () => ({ showNotice: jest.fn() }));

const instalarMock = jest.fn();

/**
 * Todos los caminos de una instalación tienen que acabar en algo que se lea.
 *
 * El fallo que motivó esto: al aceptar, el evento se gastaba, `shouldAsk` se
 * ponía a falso y el aviso desaparecía sin que nada ocupara su sitio. El
 * proceso se quedaba a medias para siempre y no había forma de saber si había
 * funcionado.
 */
function hook(over: Partial<AppInstall> = {}): AppInstall {
  return {
    view: { state: 'instalable', manualSteps: ['Abre el menú del navegador.'], visible: true },
    platform: 'android',
    standalone: false,
    installing: false,
    veredicto: 'ninguno',
    cerrarVeredicto: jest.fn(),
    install: instalarMock,
    decideAskAgain: jest.fn(),
    shouldAsk: true,
    pushNotice: null,
    ...over,
  } as AppInstall;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  (useAppInstall as jest.Mock).mockReturnValue(hook());
});

afterEach(() => {
  jest.useRealTimers();
});

async function dejarAparecer() {
  render(<InstallPromptBanner />);
  await jest.advanceTimersByTimeAsync(1500);
}

describe('InstallPromptBanner: el aviso', () => {
  it('pregunta cuando el navegador dice que puede instalar', async () => {
    await dejarAparecer();
    expect(screen.getByText('¿Quieres MiCasa en tu pantalla de inicio?')).toBeTruthy();
  });

  it('no aparece cuando ya está instalada', async () => {
    (useAppInstall as jest.Mock).mockReturnValue(hook({ shouldAsk: false, standalone: true }));
    await dejarAparecer();
    expect(screen.queryByText('¿Quieres MiCasa en tu pantalla de inicio?')).toBeNull();
  });

  it('el delay se respeta: antes de 1,2 s no hay nada', () => {
    render(<InstallPromptBanner />);
    jest.advanceTimersByTime(500);
    expect(screen.queryByText('¿Quieres MiCasa en tu pantalla de inicio?')).toBeNull();
  });
});

describe('InstallPromptBanner: el veredicto se ve acabar', () => {
  it('mientras instala, la tarjeta dice que se está instalando', async () => {
    (useAppInstall as jest.Mock).mockReturnValue(hook({ installing: true, shouldAsk: false }));
    await dejarAparecer();
    // `shouldAsk` es falso porque el evento ya se gastó. Si esto no se pinta, la
    // persona se queda mirando un proceso que no termina.
    expect(screen.getByText('Instalando MiCasa…')).toBeTruthy();
  });

  it('si el navegador no confirma, lo dice y dice dónde mirar', async () => {
    (useAppInstall as jest.Mock).mockReturnValue(hook({ veredicto: 'sin-confirmar', shouldAsk: false }));
    await dejarAparecer();
    expect(screen.getByText('No hemos podido confirmar la instalación')).toBeTruthy();
    // El cajón de aplicaciones: es donde aparece y donde la gente no mira.
    expect(screen.getByText(/cajón de aplicaciones/)).toBeTruthy();
  });

  it('el veredicto se ve aunque todavía no hayan pasado los 1,2 s del retardo', () => {
    // El retardo es para el *pregunto*, no para el resultado. Si alguien instala
    // desde Ajustes en el primer segundo y medio, su resultado también se tiene
    // que ver: con el retardo delante, ese intento se quedaba mudo.
    (useAppInstall as jest.Mock).mockReturnValue(hook({ veredicto: 'sin-confirmar', shouldAsk: false }));
    render(<InstallPromptBanner />);
    jest.advanceTimersByTime(500);
    expect(screen.getByText('No hemos podido confirmar la instalación')).toBeTruthy();
  });

  it('instalada sí, y se dice: el final bueno no es un silencio', async () => {
    // Instalar bien terminaba sin decir nada: el aviso se retiraba y el icono
    // aparecía, sin confirmación de que aquello era el fin.
    (useAppInstall as jest.Mock).mockReturnValue(hook({ veredicto: 'confirmada', shouldAsk: false }));
    await dejarAparecer();
    expect(screen.getByText('MiCasa ya está instalada')).toBeTruthy();
  });

  it('mientras instala no hay forma de cerrar el cartel', async () => {
    // Con el cierre, tocar el cartel lo hacia desaparecer sin decir nada: se
    // cancelaba el aviso de "no hemos podido confirmar" y no quedaba nada en
    // pantalla. Es lo que se vio en un Android real.
    (useAppInstall as jest.Mock).mockReturnValue(hook({ installing: true, shouldAsk: false }));
    await dejarAparecer();
    expect(screen.getByText('Instalando MiCasa…')).toBeTruthy();
    expect(screen.queryByLabelText('Cerrar')).toBeNull();
  });

  it('el veredicto se puede cerrar, y se llama al hook', async () => {
    const cerrarVeredicto = jest.fn();
    (useAppInstall as jest.Mock).mockReturnValue(hook({ veredicto: 'sin-confirmar', shouldAsk: false, cerrarVeredicto }));
    await dejarAparecer();
    fireEvent.press(screen.getByLabelText('Cerrar'));
    expect(cerrarVeredicto).toHaveBeenCalled();
  });

  it('mientras instala no se ofrece volver a instalar', async () => {
    (useAppInstall as jest.Mock).mockReturnValue(hook({ installing: true, shouldAsk: false }));
    await dejarAparecer();
    expect(screen.queryByText('Instalar')).toBeNull();
    expect(screen.queryByText('Ahora no')).toBeNull();
  });
});

describe('InstallPromptBanner: lo que devuelve instalar', () => {
  it('un diálogo cerrado por la persona se dice, y no se confunde con "ahora no"', async () => {
    instalarMock.mockResolvedValue('cerrada');
    await dejarAparecer();
    fireEvent.press(screen.getByText('Instalar'));
    await waitFor(() => expect(showNotice).toHaveBeenCalled());
    const [titulo, cuerpo] = (showNotice as jest.Mock).mock.calls[0];
    expect(titulo).toBe('Instalación cancelada');
    // Antes esto devolvía 'no' y la tarjeta de Ajustes decía "Se instala desde
    // el navegador", que no es lo que pasó: el diálogo sí se enseñó.
    expect(cuerpo).toMatch(/cerrado el diálogo/i);
  });

  it('un navegador que ya no lo permite dice la alternativa que siempre funciona', async () => {
    instalarMock.mockResolvedValue('no-permitido');
    await dejarAparecer();
    fireEvent.press(screen.getByText('Instalar'));
    await waitFor(() => expect(showNotice).toHaveBeenCalled());
    expect((showNotice as jest.Mock).mock.calls[0][0]).toBe('No se puede pedir desde aquí');
  });

  it('sin evento, se remite a los pasos manuales', async () => {
    instalarMock.mockResolvedValue('todavia-no');
    await dejarAparecer();
    fireEvent.press(screen.getByText('Instalar'));
    await waitFor(() => expect(showNotice).toHaveBeenCalled());
    expect((showNotice as jest.Mock).mock.calls[0][0]).toBe('Se instala desde el navegador');
  });

  it('al aceptar no sale ningún alert: el veredicto lo pinta la propia tarjeta', async () => {
    // Con un alert y nada más, la persona ve un mensaje que se va y un aviso que
    // ha desaparecido. Sin feedback persistente, el proceso no parece acabar.
    instalarMock.mockResolvedValue('si');
    await dejarAparecer();
    fireEvent.press(screen.getByText('Instalar'));
    await waitFor(() => expect(instalarMock).toHaveBeenCalled());
    expect(showNotice).not.toHaveBeenCalled();
  });
});
