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
