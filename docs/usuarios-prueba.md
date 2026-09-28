# Usuarios de prueba

Cuentas creadas a mano en Supabase para reproducir en un navegador real lo que
los tests de Jest no alcanzan. Viven en **producción**, así que este documento
avisa de lo que se puede y lo que no se puede hacer con ellas.

## Por qué existen

Los tests unitarios no comprueban una cosa: que el navegador llegue a registrar
una suscripción de verdad. Para eso hay que ejecutar la app de verdad, con
sesión, contra la base de datos real. Es exactamente el hueco que dejó el bug
del interruptor de notificaciones: 517 tests en verde y el alta sin completarse
ni una vez.

En esta sesión además descubrimos que **Playwright no arrancaba** en esta
máquina (`libnspr4.so` ausente y sin sudo). Se resuelve sin instalar nada del
sistema, extrayendo las librerías a mano:

```bash
mkdir -p /tmp/opencode/chromelibs/{debs,root}
cd /tmp/opencode/chromelibs/debs
apt-get download libnspr4 libnss3 libasound2t64
for f in *.deb; do dpkg-deb -x "$f" /tmp/opencode/chromelibs/root; done
export LD_LIBRARY_PATH=/tmp/opencode/chromelibs/root/usr/lib/x86_64-linux-gnu
```

Con eso arranca el Chromium que trae Playwright en `~/.cache/ms-playwright`.

## `qa-toggle@micasa.dev`

Cuenta de prueba para el flujo de avisos push.

| | |
|---|---|
| Usuario | `qa-toggle@micasa.dev` |
| Contraseña | en `QA_PUSH_PASS` de `.env.local`, no en el repo |
| Email | confirmado |
| Casas | ninguna; entra y ve una casa vacía |
| Suscripciones | una fila con un endpoint falso de FCM; el dispatcher acabará marcándola `inactive` |

Las credenciales viven en `.env.local` (ignorado por git, línea 56 del
`.gitignore`) como `QA_PUSH_USER` y `QA_PUSH_PASS`, junto al resto de
configuración local. **No se suben al repo**: una contraseña en claro en un
fichero versionado sobrevive a todo.

### Por qué el endpoint de la suscripción es falso

El test sustituye `PushManager.subscribe` con una suscripción de mentira cuyo
endpoint es `https://fcm.googleapis.com/fcm/send/qa<timestamp>`. La fila se
inserta de verdad, y por eso la alta completa contra producción, pero ese
endpoint no existe para el push service. Al Dispatcher le llegará y fallará,
que es justo lo esperado.

Consecuencia: esa fila la va a tocar el dispatcher y sus envíos van a fallar.
Hoy está en `active = true` porque todavía no ha acumulado suficientes reintentos;
cuando reúna `MAX_FAILURES` el propio dispatcher la marcará `inactive`. **Es
normal en las dos direcciones y no hay que limpiarla.** Si molesta, se borra con
`delete from push_subscriptions where endpoint like 'https://fcm.googleapis.com/fcm/send/qa%'`.

### Cómo se reprodujo el ciclo completo

Solo se sustituye la API de push del navegador. El service worker, Supabase, las
políticas RLS y la Edge Function son los de producción, que es lo que hay que
verificar:

```js
// en Playwright, con context.addInitScript
Object.defineProperty(window.Notification, 'permission', { get: () => 'granted' });
window.Notification.requestPermission = async () => 'granted';
window.PushManager.prototype.subscribe = async () => fakeSubscription;
window.PushManager.prototype.getSubscription = async () => (suscribed ? fake : null);
```

Con eso se activa, se desactiva y se vuelve a activar, y se comprueba después
que hay fila en `push_subscriptions` y `push_preferences.enabled = true`.

El permiso real no se puede conceder en headless: Chromium lo deja en `denied`
y `subscribe()` falla con `AbortError: Registration failed - permission denied`.
Por eso se sustituye en lugar de esperar a que Chromium conceda el permiso, que no ocurre.

## Cómo se recrea una cuenta de prueba

`auth.users` no se puede rellenar a mano de forma fiable (el hash de la
contraseña lo genera GoTrue, no Postgres). El camino correcto son dos pasos:

```bash
# 1. Signup por la API: crea el usuario y devuelve su id.
URL=$(grep EXPO_PUBLIC_SUPABASE_URL .env | cut -d= -f2-)
KEY=$(grep EXPO_PUBLIC_SUPABASE_ANON_KEY .env | cut -d= -f2-)
curl -s -X POST "$URL/auth/v1/signup" -H "apikey: $KEY" \
  -H "content-type: application/json" \
  -d '{"email":"qa-algo@micasa.dev","password":"unaClaveLarga123"}'
```

2. Confirmar el email, porque el proyecto exige verificación y sin esto no hay
   sesión. Es un `update` sobre `auth.users` y solo lo puede hacer quien tenga
   acceso al proyecto por SQL:

```sql
update auth.users set email_confirmed_at = now() where email = 'qa-algo@micasa.dev';
```

## Reglas para no convertir esto en un agujero

- **Nunca datos reales.** Ni una casa, ni contactos, ni citas de verdad. Una
  cuenta de prueba con datos reales es una fuga esperando a que alguien la
  encontrara.
- **Nunca una cuenta de prueba en un dispositivo compartido** en el que se
  pueda iniciar sesión con la cuenta buena. El logout da de baja la suscripción
  push, pero el resto de la sesión es de la cuenta con la que se entró.
- **La suscripción push de un dispositivo de prueba no debe quedarse puesta.**
  Cada navegador es una suscripción. Al terminar, cerrar sesión da de baja la
  de ese navegador, y eso es lo correcto.
- **La contraseña de la cuenta no viaja en el bundle ni en ningún fichero
  versionado.** Por eso está en `.env.local` y no aquí.
- Estas cuentas no son un mecanismo de pruebas automatizadas. Si un test de CI
  necesita una, es un test que debería llevar su propio `beforeAll` con las
  credenciales de un secret, no una cuenta fija en producción.
