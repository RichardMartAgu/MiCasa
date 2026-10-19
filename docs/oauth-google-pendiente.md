# Pendiente — OAuth Google (bloque implementado, botón oculto)

Estado 2026-10-19: el código está en `develop` (`src/lib/oauth.ts`,
`signInWithGoogle` en `src/context/auth-context.tsx`), pero el botón «Continuar con
Google» se ocultó de `src/app/login.tsx` porque el provider sigue deshabilitado en
Supabase y el login siempre fallaba con «Este método de acceso no está disponible en
este momento». La rama `feat/oauth-google` ya no existe.

Para reactivarlo: configurar Google Cloud + Supabase (pasos abajo) y volver a
renderizar el botón en `login.tsx` (bloque eliminado; recuperar de git history).

## Pasos configuración (requieren credenciales Google)

1. Google Cloud Console → crear OAuth client ID tipo **Web application**:
   - Authorized redirect URIs: URL callback de Supabase Dashboard (Auth → Providers → Google) + `http://localhost:8081` + `https://micasa-demo.vercel.app`.
   - Guardar Client ID + Secret.
2. Supabase Dashboard (`sxgsqvwvugdklycpqxiu`) → Auth → Providers → Google:
   - enabled, Client ID + Secret.
3. Redirect URLs (Auth → URL Configuration): `micasa://`, `exp://` (Expo Go), `http://localhost:8081`, `https://micasa-demo.vercel.app`.

## Archivos tocados

- `src/lib/oauth.ts` (nuevo) — parseCallbackUrl, buildRedirectUri
- `src/context/auth-context.tsx` — signInWithGoogle + finishWebRedirect
- `src/app/login.tsx` — botón "Continuar con Google"
- `src/lib/errors.ts` — regla provider not enabled
- `__tests__/oauth.test.ts` (nuevo) + `__tests__/auth-context.test.tsx` — 9 tests

## Nota

Working tree tenía cambios previos sin commit (30+ archivos, no de este bloque).