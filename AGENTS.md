# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Idioma

Responde siempre en español, salvo que el usuario pida explícitamente otro idioma.

# Acceso a info (menos tokens)

- Leer `INDEX.md` antes de explorar. No abrir .md a ciegas.
- Skills: viven en `~/.config/opencode/skills/`. Cargar SOLO el aplicable según tabla en INDEX.md. No abrir SKILL.md de skill irrelevante.
- Agentes: consultar tabla en INDEX.md → invocar solo el que aplica al bloque. Flujo: orquestador → back/front → security → qa-test.
- Código: grep/glob antes de Read. `src/lib/` = lógica pura testeable.
- Docs: `README.md` bajo demanda, no entero. `docs/*.json` para workflow/arquitectura.

# Emails (Resend)

MiCasa envía correos con **Resend**:

- **SMTP de Supabase Auth**: verify/recovery con dominio propio (SPF/DKIM configurados).
- **Transaccionales**: invitación a casa, bienvenida, recordatorios de citas/cumpleaños, avisos de presupuesto. Via Edge Function en `supabase/functions/` con `RESEND_API_KEY` en secrets.
- Nunca hardcodear claves; `RESEND_API_KEY` vive en secrets de Supabase/Vercel.

# Frontend web

La app móvil Expo vive en `src/` (paleta Dusk). El frontend web vive en **`web/`** (Astro + shadcn-astro + tailwind merge + Nano Stores + astro-icon, Mobile-First). Ambos comparten paleta Dusk y capa de datos sobre Supabase.

# Agentes del proyecto

Seis agentes especializados viven en `.opencode/agents/` e intervienen en el flujo de trabajo:

- **`orquestador`**: coordina. Descompone objetivos en bloques, asigna a back/front, lanza security y qa-test tras cada bloque, gestiona veredictos, coordina deploy con devops. Única vía hacia el usuario.
- **`back`**: Supabase (PostgreSQL + RLS + Realtime + Edge Functions Deno) y Resend (SMTP auth + transaccionales).
- **`front`**: app móvil Expo (`src/`) y frontend web Astro (`web/`), paleta Dusk.
- **`security`**: auditoría de seguridad read-only por bloque. Veredicto APROBADO/REVISAR/BLOQUEADO + 3-5 preguntas estratégicas.
- **`qa-test`**: calidad. Typecheck, lint, tests (Jest móvil, Vitest/Playwright web), cobertura y edge cases. Veredicto PASA/REVISAR/FALLA.
- **`devops`**: CI/CD (GitHub Actions), deploys Vercel/EAS, migraciones Supabase, secrets (incluida `RESEND_API_KEY`) y salud del entorno.

# Flujo por bloque de código

1. `orquestador` descompone el objetivo en bloques y asigna cada uno a `back` o `front`.
2. El agente autor escribe/refactoriza el bloque: código limpio, documentado, probado, UI Dusk.
3. Inmediatamente después, invocar `security` (vía Task tool) con los archivos/líneas cambiadas. Es read-only.
4. Invocar `qa-test` para validar typecheck, lint y tests.
5. Ningún bloque se da por terminado ni se commitea hasta que `security` devuelve **APROBADO** y `qa-test` **PASA** (o los hallazgos están remediados).
6. Si `security` o `qa-test` formulan preguntas, el orquestador las transmite al usuario y espera decisión si afectan al bloque.
7. Verificar antes de entregar: `npx tsc --noEmit`, `npx expo lint`, `npx jest` (+ checks de `web/` si aplica).

# Regla dura (no negociable)

Ningún bloque de código se da por terminado ni se commitea si el `security` devuelve **BLOQUEADO** o `qa-test` **FALLA**. Si la auditoría falla, primero se corrigen los hallazgos y después se vuelve a auditar hasta obtener **APROBADO**/**PASA**.

## Regla dura: aislamiento de features

Toda feature nueva o refactorización significativa se trabaja en **worktree separado + rama propia** que sale de `develop`. Nunca se escribe directamente en `develop` ni en `main`.

### Flujo obligatorio

1. Crear rama desde `develop`: `git checkout develop && git checkout -b feat/nombre-feature`
2. Crear worktree: `git worktree add ../MiCasa-nombre-feature feat/nombre-feature`
3. Trabajar dentro del worktree (`/home/richard/MiCasa-nombre-feature/`)
4. Cuando el bloque pase security (**APROBADO**) + qa-test (**PASA**):
   - Hacer commit en el worktree
   - Empujar rama: `git push -u origin feat/nombre-feature`
5. Una vez TODOS los bloques de la feature completados y auditados:
   - Crear PR contra `develop`
   - Merge solo tras approval del usuario
6. Limpiar worktree: `git worktree remove ../MiCasa-nombre-feature`

### Por qué

- Evita romper `develop` con código en progreso
- Permite trabajar en múltiples features en paralelo
- Cada feature tiene su historial limpio de commits
- Rollback simple si algo sale mal

### Excepciones

- Hotfixes críticos de seguridad → rama `hotfix/` desde `main`, sin worktree
- Cambios documentales (README, docs) → directo en rama correspondiente

# Despliegue

Antes de desplegar (local `npm run demo` o Vercel `npm run deploy:vercel`):

1. Comprueba si hay versión nueva del código: `scripts/serve-demo.sh` compara el commit `HEAD` contra la fecha del build en `dist/`. Si el commit es más reciente, reconstruye `dist/` con `npx expo export --platform web` antes de servir.
2. Nunca sirvas un `dist/` antiguo. Si no usas el script, corre `npm run build:web` siempre antes de servir o desplegar.
3. Tras desplegar, verifica la app: `curl -s -o /dev/null -w "%{http_code}" https://micasa-demo.vercel.app` → debe responder `200`.

`devops` supervisa despliegues, migraciones y secrets.

# Notificaciones por Telegram

Cuando haya actualizaciones de estado relevantes para el usuario (bloque terminado, auditoría, deploy, errores), notificar por Telegram usando `telegram-opencode-bot`:

```bash
bash scripts/notify-telegram.sh "Mensaje"
```

El script lee `TELEGRAM_BOT_TOKEN` de `~/telegram-opencode-bot/.env` y usa el último `chat_id` conocido de la API de Telegram.