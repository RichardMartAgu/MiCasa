import { act, fireEvent, render } from '@testing-library/react-native';

import { InstallPromptBanner } from '@/components/install-prompt-banner';

const mockInstall = jest.fn(async () => 'si' as const);
// Se comporta como el hook de verdad: decidir esconde el aviso. Si el mock no
// cambiara nada, el test de "ahora no" estaría probando que el mock no cambia.
const mockDecideAskAgain = jest.fn((decision: string) => {
  if (decision === 'no' || decision === 'no-preguntar-mas') mockEstado.shouldAsk = false;
});
const mockShowNotice = jest.fn();

type Estado = {
  shouldAsk: boolean;
  installing: boolean;
  standalone: boolean;
  platform: string;
  view: Record<string, unknown>;
  pushNotice: { title: string; body: string } | null;
};

const POR_DEFECTO: Estado = {
  shouldAsk: true,
  installing: false,
  standalone: false,
  platform: 'android',
  view: {
    visible: true,
    title: 'Instala la app',
    body: '',
    steps: [],
    manualSteps: [],
    action: 'Instalar ahora',
    actionIsPrompt: true,
    atajoNoEsApp: null,
  },
  pushNotice: null,
};

let mockEstado: Estado = { ...POR_DEFECTO };

jest.mock('@/hooks/use-app-install', () => ({
  useAppInstall: () => ({
    ...mockEstado,
    install: mockInstall,
    decideAskAgain: (decision: string) => mockDecideAskAgain(decision),
  }),
}));

jest.mock('@/lib/notice', () => ({
  showNotice: (...args: unknown[]) => mockShowNotice(...args),
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: ({ name }: { name: string }) => <Text>{name}</Text> };
});

const NO_PREGUNTAR = 'No preguntar más';

// Parte siempre del estado por defecto y no del que dejó el test anterior: el
// mock muta `shouldAsk` al decidir, y sin esto un test que decidía dejaba al
// siguiente con el aviso ya callado y sin banner que pulsar.
function base(overrides: Partial<Estado> = {}) {
  mockEstado = { ...POR_DEFECTO, ...overrides };
}

describe('el aviso-emergente de instalar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    base();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('pregunta con un botón, y el botón instala', async () => {
    const { getByText, queryByText } = render(<InstallPromptBanner />);

    // Primero no se ve: el evento suele llegar nada más cargar y un cartel que
    // salta encima de la pantalla mientras se lee no se lee.
    expect(queryByText('¿Quieres MiCasa en tu pantalla de inicio?')).toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(1500);
    });

    expect(getByText('¿Quieres MiCasa en tu pantalla de inicio?')).toBeTruthy();
    expect(getByText('Instalar')).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByText('Instalar'));
    });

    expect(mockInstall).toHaveBeenCalledTimes(1);
  });

  it('al instalar dice que se está instalando, y NO dice que ya está instalada', async () => {
    // El bug que hizo que alguien creyera que la tenía puesta: aceptar el
    // diálogo del navegador no es instalar. Hasta que llegue `appinstalled`, lo
    // único cierto es que está en marcha.
    mockInstall.mockResolvedValue('si' as never);
    const { getByText } = render(<InstallPromptBanner />);
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });

    await act(async () => {
      fireEvent.press(getByText('Instalar'));
    });

    const [titulo, cuerpo] = mockShowNotice.mock.calls[0] as [string, string];
    expect(titulo).toBe('Se está instalando');
    expect(cuerpo).toContain('pantalla de inicio');
    expect(`${titulo} ${cuerpo}`).not.toContain('App instalada');
  });

  it('si la persona lo rechaza, se le dice que se hace desde el menú, no que se instaló', async () => {
    mockInstall.mockResolvedValue('no' as never);
    const { getByText } = render(<InstallPromptBanner />);
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });

    await act(async () => {
      fireEvent.press(getByText('Instalar'));
    });

    const [titulo, cuerpo] = mockShowNotice.mock.calls[0] as [string, string];
    expect(titulo).toBe('Se instala desde el navegador');
    expect(cuerpo).toContain('menú del navegador');
  });

  it('"ahora no" lo esconde pero no lo recuerda para siempre', async () => {
    const { getByText, queryByText, rerender } = render(<InstallPromptBanner />);
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });

    await act(async () => {
      fireEvent.press(getByText('Ahora no'));
    });
    // El hook de verdad cambia de estado al decidir, y eso repinta. El mock no
    // tiene estado, así que hay que forzar el repintado para ver el efecto.
    await act(async () => {
      rerender(<InstallPromptBanner />);
    });

    expect(mockDecideAskAgain).toHaveBeenCalledWith('no');
    expect(queryByText('¿Quieres MiCasa en tu pantalla de inicio?')).toBeNull();
  });

  it('"no preguntar más" se puede tocar en el texto y en la X, y se recuerda', async () => {
    // Las dos vías tienen que hacer lo mismo: la X y el texto.
    const { getByText, getByLabelText, unmount } = render(<InstallPromptBanner />);
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });

    await act(async () => {
      fireEvent.press(getByText(NO_PREGUNTAR));
    });
    expect(mockDecideAskAgain).toHaveBeenCalledWith('no-preguntar-mas');
    unmount();

    // La X hace lo mismo, en un montaje limpio: si la preferencia ya estuviera
    // guardada el aviso ni se enseñaría, así que hay que empezar de cero.
    base();
    const otra = render(<InstallPromptBanner />);
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    expect(otra.getByLabelText('No preguntar más')).toBeTruthy();
    await act(async () => {
      fireEvent.press(otra.getByLabelText('No preguntar más'));
    });
    expect(mockDecideAskAgain).toHaveBeenCalledTimes(2);
    expect(mockDecideAskAgain).toHaveBeenLastCalledWith('no-preguntar-mas');
  });

  it('no se enseña cuando el navegador no puede instalar, ni cuando ya está instalada', async () => {
    // En iPhone no hay evento, y con la app puesta preguntar es absurdo. En los dos
    // casos la tarjeta de Ajustes es el sitio, y ahí no aparece esto.
    base({ shouldAsk: false });
    const primera = render(<InstallPromptBanner />);
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    expect(primera.queryByText('¿Quieres MiCasa en tu pantalla de inicio?')).toBeNull();
    primera.unmount();

    base({ shouldAsk: true, standalone: true, shouldAskOverride: undefined } as never);
    const segunda = render(<InstallPromptBanner />);
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    expect(segunda.queryByText('¿Quieres MiCasa en tu pantalla de inicio?')).toBeTruthy();
  });
});
