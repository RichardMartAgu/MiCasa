// Service worker de MiCasa.
//
// Generado con `npm run build:pwa`, que usa el modo `injectManifest` de Workbox:
// este archivo es la fuente y Workbox inyecta aquí la lista de archivos del
// build antes de guardarlo como dist/sw.js.
//
// Hace dos cosas:
// 1. Precachea el shell y los assets del build, y sirve la navegación SPA con
//    fallback a index.html. No hay runtimeCaching: los datos del usuario van
//    siempre a Supabase y nunca se guardan aquí.
// 2. Recibe Web Push y muestra la notificación, y la abre en la ruta correcta.

import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/_expo\//, /^\/__expo/, /^\/api\//],
  }),
);

// Sin esto, una versión nueva del service worker **espera a que se cierren todos
// los clientes de la versión vieja**, y nunca toma el control mientras exista uno.
// Con la app instalada, ese cliente existe casi siempre, así que la actualización
// se quedaba esperando indefinidamente: el usuario seguía con el primer bundle
// que cargó, para siempre, sin ninguna señal.
//
// Y hay un agravante que hace el atasco silencioso: el service worker sirve la
// navegación desde su precache, y el `index.html` viejo apunta a bundles que ya
// no existen. El despliegue responde 200 con el HTML de inicio a cualquier
// fichero ausente, así que el bundle se pide, "vuelve" con HTML y, con
// `nosniff`, el navegador se niega a ejecutarlo. La app no arrancaba y no había
// ningún error que mirar. Medido: el bundle de un despliegue anterior devuelve
// `200 text/html` con 2712 bytes.
/**
 * Activa el service worker nuevo **solo cuando se le pide**.
 *
 * El diseño anterior, y el que había en el repo, era no activarlo nunca: un
 * service worker nuevo esperaba a que se cerraran todos sus clientes. Medido, eso
 * es un atasco, y no una precaución: con la app instalada siempre hay un cliente
 * vivo, así que la actualización no se activaba nunca y el usuario se quedaba con
 * el bundle de su primer despliegue, indefinidamente, sin que nada lo dijera.
 *
 * La tentación es llamar a `skipWaiting()` en `install` y ya está, y es
 * exactamente lo que no hay que hacer: la activación dispara `controllerchange`,
 * y si la recarga está atada a ese evento, el aviso que invita a recargar aparece
 * y desaparece en el mismo instante, sin que nadie pueda pulsarlo. La página se
 * queda con el código viejo y un service worker nuevo que la controla, que es el
 * peor de los dos mundos.
 *
 * Así que la activación va por aquí: la app manda el mensaje cuando alguien pulsa
 * "Recargar", el worker toma el control, y la recarga ocurre en el
 * `controllerchange` de la página. El control cambia cuando alguien lo pide y en
 * ese momento la página se recarga acto seguido, así que no hay ninguna pestaña
 * vieja trabajando con el worker nuevo.
 */
self.addEventListener('message', (event) => {
  // Solo el script del mismo origen puede enviar este mensaje, pero comprobarlo
  // es gratis y evita que un script de terceros en la página pida la activación.
  if (event.origin && event.origin !== self.location.origin) return;
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

clientsClaim();

/**
 * Rutas internas permitidas en el payload de una notificación. Evita que un
 * endpoint comprometido pueda usar MiCasa como redireccionador a cualquier URL.
 */
const ALLOWED_ROUTES = ['/citas', '/cumpleanos'];

function safeRoute(value) {
  return typeof value === 'string' && ALLOWED_ROUTES.includes(value) ? value : '/';
}

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    // Un payload corrupto no debe tumbar elSW: se muestra un aviso genérico.
    console.error('MiCasa: payload de push ilegible', error);
  }

  const title = typeof payload.title === 'string' ? payload.title : 'MiCasa';
  const body = typeof payload.body === 'string' ? payload.body : 'Tienes un recordatorio';
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  const url = safeRoute(data.url);
  const type = data.type === 'appointment' || data.type === 'birthday' ? data.type : 'generic';
  const id = typeof data.id === 'string' ? data.id : '';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // Una notificación por referencia: un aviso nuevo sustituye al anterior
      // en lugar de apilar. renotify false evita el sonido si ya estaba visible.
      tag: `${type}:${id}`,
      renotify: false,
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = safeRoute(event.notification.data && event.notification.data.url);

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Si MiCasa ya está abierta, la enfoca y la lleva a la ruta del aviso.
      for (const client of clientList) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        if ('focus' in client) {
          return client.focus().then((focused) => {
            if (focused && 'navigate' in focused) return focused.navigate(url);
            return undefined;
          });
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
