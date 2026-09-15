# Pendiente — OAuth Google (bloque implementado)

Estado: código listo, tests OK (280), lint OK. Commit en rama `feat/oauth-google`.
Pendiente: config dashboard (Google Cloud + Supabase) y PR.

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