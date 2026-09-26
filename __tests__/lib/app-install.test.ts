import {
  detectPlatform,
  installView,
  pushNeedingInstallNotice,
  pushNeedsInstalledApp,
  resolveState,
  type InstallPlatform,
  type InstallState,
} from '@/lib/app-install';

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  ipadOS:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  firefoxMobile:
    'Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0',
  desconocido: 'Mozilla/5.0 (desconocido) algo',
};

describe('detectPlatform', () => {
  it('distingue iPhone, Android y escritorio', () => {
    expect(detectPlatform(UA.iphone)).toBe('ios');
    expect(detectPlatform(UA.android)).toBe('android');
    expect(detectPlatform(UA.windows)).toBe('desktop');
    expect(detectPlatform(UA.linux)).toBe('desktop');
  });

  it('ChromeOS es escritorio, no un navegador desconocido', () => {
    // En un Chromebook los pasos del menú son los de escritorio, y con el UA mal
    // clasificado la tarjeta acabaría en el texto genérico de "otro".
    expect(
      detectPlatform(
        'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      ),
    ).toBe('desktop');
  });

  it('un Mac con Safari NO es un iPad, y no puede recibir los pasos de iPhone', () => {
    // El caso que se lleva por delante, y en las dos direcciones. Desde iPadOS 13
    // el iPad se anuncia con EXACTAMENTE la misma cadena que un Mac, y Safari
    // dice el mismo proveedor en los dos. Lo único que los separa son los puntos
    // de contacto.
    //
    // Sin esto, un Mac con Safari recibia "Abre el menu Compartir" y
    // "Anadir a pantalla de inicio", que en macOS no existen.
    expect(detectPlatform(UA.macSafari, 0)).toBe('desktop');
    expect(detectPlatform(UA.macSafari, 1)).toBe('desktop');
    expect(detectPlatform(UA.ipadOS, 5)).toBe('ios');
  });

  it('un iPad con cualquier navegador cae en iOS, no en escritorio', () => {
    // iOS nunca lanza `beforeinstallprompt`, asi que si el iPad cae en
    // 'desktop' la tarjeta dice "este navegador no puede instalarla", y eso es
    // falso: desde iOS 16.4 cualquier navegador puede anadirla a la pantalla de
    // inicio. El fallo no es de los pasos, es de la senal.
    for (const navegador of [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
    ]) {
      expect(detectPlatform(navegador, 5)).toBe('ios');
    }
  });

  it('con dos puntos de contacto ya se considera iPad', () => {
    // La frontera exacta. Con `> 2` un iPad que declarara dos o tres puntos caería
    // en escritorio y la tarjeta le diría que su navegador no puede instalar, que
    // es falso. El valor por defecto de los iPad reales es 5, pero el número no es
    // la garantía: la Presence de touch sí lo es.
    expect(detectPlatform(UA.ipadOS, 2)).toBe('ios');
    expect(detectPlatform(UA.ipadOS, 1)).toBe('desktop');
  });

  it('un navegador que no se conoce no se inventa: se queda en otro', () => {
    expect(detectPlatform(UA.desconocido)).toBe('otro');
    expect(detectPlatform('')).toBe('otro');
  });

  it('un iPad con version antigua y un iPod tambien son iOS', () => {
    // Desde iPadOS 13 el iPad se anuncia como Mac, pero un iPad con version
    // anterior sigue diciendo "iPad" en su cadena, y un iPod no se ha retirado.
    expect(detectPlatform('Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15')).toBe(
      'ios',
    );
    // La UA lleva "iPod" y no "iPhone" a propósito: con "iPhone" dentro entraría por
    // la otra alternativa del regex y la de iPod no estaría probada.
    expect(detectPlatform('Mozilla/5.0 (iPod; U; CPU like Mac OS X; en)')).toBe('ios');
  });

  it('un Mac sin puntos de contacto declarados no se vuelve iPad por defecto', () => {
    // El valor por defecto de `maxTouchPoints` es 0, no 5: si un navegador no lo
    // declara, se trata como un Mac. Un iPad que no lo declare perderia los pasos
    // correctos, pero inventarlos seria peor: mandaria a un Mac a buscar un menu
    // Compartir.
    expect(detectPlatform(UA.macSafari)).toBe('desktop');
    expect(detectPlatform(UA.ipadOS)).toBe('desktop');
  });
});

describe('resolveState', () => {
  const base = { platform: 'android' as InstallPlatform, native: false, standalone: false };

  it('si ya esta instalada no se ofrece instalarla', () => {
    expect(resolveState({ ...base, standalone: true, promptAvailable: false })).toBe('instalada');
  });

  it('en nativo no hay nada que instalar, y se da por instalada', () => {
    expect(resolveState({ ...base, native: true, promptAvailable: false })).toBe('instalada');
  });

  it('solo es instalable cuando el navegador ha dado el evento', () => {
    // No se deduce de que la PWA cumpla los requisitos: se espera al evento.
    // Por eso una web instalable sin evento no promete un boton que no va a
    // funcionar.
    expect(resolveState({ ...base, promptAvailable: true })).toBe('instalable');
  });

  it('sin evento, en cualquier plataforma, hay pasos manuales', () => {
    // Antes, sin evento en Android se declaraba "no instalable", y eso afirmaba
    // algo que no se sabe: que el navegador no podrá instalarla. Medido en un
    // Chromium de verdad, el navegador decía cero errores de instalabilidad
    // mientras la app afirmaba lo contrario. Ahora sin evento hay pasos, en todas
    // las plataformas, que es lo único que es cierto en todos los casos.
    for (const plataforma of ['ios', 'android', 'desktop', 'otro'] as InstallPlatform[]) {
      expect(`${plataforma}: ${resolveState({ ...base, platform: plataforma, promptAvailable: false })}`).toBe(
        `${plataforma}: manual`,
      );
    }
  });

  it('la app instalada gana al evento: no se ofrece instalar dos veces', () => {
    expect(resolveState({ ...base, standalone: true, promptAvailable: true })).toBe('instalada');
  });
});

describe('installView', () => {
  const estados: InstallState[] = ['instalada', 'instalable', 'manual'];

  it('un boton con un toque solo existe cuando el navegador puede instalar', () => {
    expect(installView('instalable', 'android').actionIsPrompt).toBe(true);
    expect(installView('instalable', 'android').action).toBe('Instalar ahora');
    for (const estado of ['instalada', 'manual'] as InstallState[]) {
      expect(installView(estado, 'android').actionIsPrompt).toBe(false);
      expect(installView(estado, 'android').action).toBeNull();
    }
  });

  it('instalada no pide hacer nada', () => {
    const view = installView('instalada', 'android');
    expect(view.steps).toHaveLength(0);
    expect(view.action).toBeNull();
    expect(view.visible).toBe(true);
  });

  it('en manual siempre hay pasos, y el primero es el más concreto', () => {
    // El primer paso es el que la persona busca: "qué toco". La pantalla lo
    // resalta por posición, no por un campo, así que lo que importa es que sea el
    // más concreto y no un relleno delante.
    for (const plataforma of ['ios', 'android', 'desktop', 'otro'] as InstallPlatform[]) {
      const view = installView('manual', plataforma);
      expect(view.steps.length).toBeGreaterThan(0);
      expect(view.steps.every((paso) => paso.length > 10)).toBe(true);
    }
  });

  it('el primer paso dice donde tocar en esa plataforma, no "sigue las instrucciones"', () => {
    // Si delante del concreto se colara un paso genérico, el resaltado apuntaría
    // al equivocado y el bug volvería sin que nada se note.
    const CONTROL = {
      ios: 'Compartir',
      android: 'menú del navegador',
      desktop: 'menú del navegador',
      otro: 'menú del navegador',
    } as const;
    for (const plataforma of ['ios', 'android', 'desktop', 'otro'] as InstallPlatform[]) {
      const view = installView('manual', plataforma);
      expect(`${plataforma}: ${view.steps[0]}`).toContain(CONTROL[plataforma]);
    }
  });

  it('los pasos de escritorio no dicen donde esta el menu', () => {
    // En macOS el menu del navegador esta en la barra del sistema, no arriba a la
    // derecha. Decirlo mandaba al Safari de un Mac, que es el navegador por
    // defecto de ese equipo, a buscar un menu que no esta ahi. El mismo problema
    // que el de "instalar" en un iPhone: un nombre de control que existe en otro
    // sistema y no en este.
    expect(installView('manual', 'desktop').steps.join(' ')).not.toContain('arriba a la derecha');
  });

  it('los pasos dicen donde tocar en cada plataforma', () => {
    const ios = installView('manual', 'ios').steps.join(' ');
    expect(ios).toContain('Compartir');
    expect(ios).toContain('pantalla de inicio');

    const android = installView('manual', 'android').steps.join(' ');
    expect(android).toContain('menú del navegador');
    expect(android).toContain('Instalar app');

    const desktop = installView('manual', 'desktop').steps.join(' ');
    expect(desktop).toContain('Instalar MiCasa');
  });

  it('el texto nombra el menu que esa plataforma tiene, no uno generico', () => {
    // El fallo de fondo era este: en iPhone no existe "instalar", existe
    // "compartir". Decir "instalar" a un iPhone es mandarle a buscar algo que no
    // va a encontrar.
    expect(installView('manual', 'ios').body).toContain('Compartir');
    expect(installView('manual', 'ios').body).not.toContain('menú del navegador');
    expect(installView('manual', 'android').body).not.toContain('Compartir');
  });

  it('sin evento NO se le dice a la persona que su navegador no puede instalarla', () => {
    // El bug, medido en un Chromium de verdad: el navegador informaba de cero
    // errores de instalabilidad y la tarjeta decía "Este navegador no puede
    // instalarla". La ausencia de `beforeinstallprompt` no prueba imposibilidad:
    // el evento sale cuando el navegador cumple sus criterios, y hay un rato
    // antes de que eso pase. Afirmar lo contrario era Contrary al navegador.
    for (const plataforma of ['ios', 'android', 'desktop', 'otro'] as InstallPlatform[]) {
      const view = installView('manual', plataforma);
      const texto = [view.title, view.body, ...view.steps].join(' ');
      expect(`${plataforma}: ${texto}`).not.toContain('no puede');
      expect(`${plataforma}: ${texto}`).not.toContain('no instalable');
    }
  });

  it('y los pasos ofrecen algo que funciona aunque el navegador no ofrezca instalar', () => {
    // El plan B va dentro de los pasos, no en un estado aparte: es lo único que
    // es cierto tanto si el evento llega tarde como si no llega nunca.
    for (const plataforma of ['android', 'desktop', 'otro'] as InstallPlatform[]) {
      const pasos = installView('manual', plataforma).steps.join(' ');
      expect(`${plataforma}: ${pasos}`).toContain('favoritos');
    }
    // En iPhone no hace falta plan B: desde iOS 16.4 siempre se puede añadir, y
    // el paso es compartir, que siempre existe.
    expect(installView('manual', 'ios').steps.join(' ')).not.toContain('favoritos');
  });

  it('con botón, los pasos se enseñan igualmente, en las 12 combinaciones', () => {
    // Antes el invariante era al revés: pasos y botón nunca a la vez. Se cambió a
    // propósito, porque con el botón delante y los pasos debajo la tarjeta no
    // cambia sola de texto cuando el navegador firma el evento, y lo que dice
    // siempre es cierto. Este test ata el invariante nuevo en las 12
    // combinaciones de estado y plataforma.
    const estados: InstallState[] = ['instalada', 'instalable', 'manual'];
    const plataformas: InstallPlatform[] = ['ios', 'android', 'desktop', 'otro'];
    for (const estado of estados) {
      for (const plataforma of plataformas) {
        const view = installView(estado, plataforma);
        const etiqueta = `${estado}/${plataforma}`;
        if (estado === 'instalable') {
          // Botón y pasos juntos, y los pasos no vacíos.
          expect(`${etiqueta}: ${view.action}`).toBe(`${etiqueta}: Instalar ahora`);
          expect(view.steps.length).toBeGreaterThan(0);
        }
        if (estado === 'instalada') {
          expect(`${etiqueta}: ${view.action}`).toBe(`${etiqueta}: null`);
          expect(`${etiqueta}: ${view.steps.length}`).toBe(`${etiqueta}: 0`);
        }
        if (view.steps.length > 0) {
          expect(view.manualSteps).toEqual(view.steps);
        }
      }
    }
  });

  it('instalable trae los pasos aunque se pinten, y sobrevive a que se gaste el evento', () => {
    // Con botón los pasos se pintan, pero `manualSteps` sigue haciendo falta: si la
    // persona rechaza el diálogo del navegador, el evento se consume, el botón
    // desaparece, y el aviso necesita decir cómo se hace a mano.
    for (const plataforma of ['ios', 'android', 'desktop', 'otro'] as InstallPlatform[]) {
      const view = installView('instalable', plataforma);
      expect(`${plataforma}: ${view.manualSteps.length}`).not.toBe(`${plataforma}: 0`);
      expect(view.manualSteps).toEqual(view.steps);
    }
  });

  it('los tres estados devuelven una vista completa y sin huecos', () => {
    for (const estado of estados) {
      const view = installView(estado, 'android');
      expect(view.title.length).toBeGreaterThan(0);
      expect(view.body.length).toBeGreaterThan(20);
      expect(typeof view.visible).toBe('boolean');
      expect(typeof view.actionIsPrompt).toBe('boolean');
    }
  });
});

describe('pushNeedsInstalledApp', () => {
  it('en iPhone los avisos necesitan la app instalada', () => {
    // Es la razon por la que se pide instalar: en iOS el Web Push solo funciona
    // en la app de la pantalla de inicio, no en una pestaña normal.
    expect(
      pushNeedsInstalledApp({ platform: 'ios', standalone: false, pushSupported: true }),
    ).toBe(true);
  });

  it('si ya esta instalada, en iPhone tambien funciona', () => {
    expect(
      pushNeedsInstalledApp({ platform: 'ios', standalone: true, pushSupported: true }),
    ).toBe(false);
  });

  it('en el resto de plataformas no hace falta', () => {
    for (const plataforma of ['android', 'desktop', 'otro'] as InstallPlatform[]) {
      expect(
        pushNeedsInstalledApp({ platform: plataforma, standalone: false, pushSupported: true }),
      ).toBe(false);
    }
  });

  it('si el navegador no soporta push, no se dice nada de instalar', () => {
    // Sin push no hay nada que pedir a cambio de instalar. Antes esto se
    // confundia: el aviso de "instala para los avisos" salia aunque el
    // navegador no pudiera enviar nada.
    expect(
      pushNeedsInstalledApp({ platform: 'ios', standalone: false, pushSupported: false }),
    ).toBe(false);
  });

  it('el aviso dice donde se hace, no solo que hay que hacerlo', () => {
    const notice = pushNeedingInstallNotice();
    expect(notice.body).toContain('Compartir');
    expect(notice.body).toContain('pantalla de inicio');
    expect(notice.title.length).toBeGreaterThan(10);
  });
});
