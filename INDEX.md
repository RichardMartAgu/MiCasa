# INDEX — MiCasa

App móvil Expo + web Astro para gestionar el hogar. 10 md, ~570 líneas (skills duplicados eliminados). Actualizar al crear/modificar/borrar cualquier .md.

## Orden de acceso (menos tokens)

1. `AGENTS.md` — reglas proyecto, stack, email, flujo agentes
2. `INDEX.md` — este índice
3. `README.md` (120L) — funcionalidades, stack, puesta en marcha, estructura datos
4. `CLAUDE.md` (1L) → redirige a AGENTS.md
5. Agentes: tabla abajo → invocar solo el que aplica. Flujo: `orquestador` → `back`/`front` → `security` → `qa-test`
6. Skills: 19 viven en global `~/.config/opencode/skills/` (no en repo). Cargar solo el aplicable.
7. Código: grep/glob antes de Read. `src/lib/` = lógica pura testeable.

## Core

| Archivo | Líneas | Propósito |
|---|---|---|
| `AGENTS.md` | 71 | Reglas proyecto, Expo v57, stack, flujo agentes, deploy. LEER primero |
| `README.md` | 120 | Funcionalidades, stack, estructura, modelo datos, npm scripts |
| `CLAUDE.md` | 1 | Redirige a AGENTS.md |

## Agentes `.opencode/agents/` (6)

| Agente | Líneas | Rol | Cuándo invocar |
|---|---|---|---|
| `orquestador` | 49 | Descompone objetivos, asigna bloques, coordina todo | Al inicio de cada tarea grande |
| `back` | 52 | Supabase (PostgreSQL, RLS, Realtime, Edge Functions, Resend) | Bloques backend, schema, emails |
| `front` | 54 | UI móvil Expo `src/` + web Astro `web/`, paleta Dusk | Bloques frontend, componentes, pantallas |
| `security` | 105 | Auditoría read-only, veredicto APROBADO/REVISAR/BLOQUEADO + preguntas | Tras cada bloque back/front |
| `qa-test` | 65 | Typecheck, lint, tests Jest/Vitest/Playwright, cobertura | Tras security en cada bloque |
| `devops` | 39 | CI/CD GitHub Actions, deploys Vercel/EAS, migraciones, secrets | Pipeline, deploy, salud entorno |

**Flujo**: orquestador → back/front → security (read-only) → qa-test → commit.
Ningún bloque se da por terminado sin **APROBADO** de security + **PASA** de qa-test.

## Skills globales (19, borrados del repo — idénticos a globales `~/.config/opencode/skills/`)

| Skill | Cuándo usar |
|---|---|
| `building-native-ui` | UI nativa Expo: componentes, pantallas, layout |
| `expo-api-routes` | API routes Expo con EAS Hosting |
| `expo-cicd-workflows` | CI/CD Expo, EAS workflows YAML |
| `expo-deployment` | Deploy App Store, Play Store, web |
| `expo-dev-client` | Dev builds Expo locales/TestFlight |
| `expo-tailwind-setup` | Tailwind v4 en Expo con NativeWind v5 |
| `native-data-fetching` | Fetch/red: fetch API, React Query, SWR, offline |
| `upgrading-expo` | Upgrade SDK Expo, fix dependencias |
| `use-dom` | DOM components en Expo, migración web incremental |
| `design-mobile-apps` | Diseño UI móvil (sleek) |
| `react-native-mobile` | App React Native producción: UI, performance, platform-specific |
| `accessibility` | WCAG 2.2, a11y audit, screen reader |
| `frontend-design` | UI web producción, diseño de interfaces |
| `seo` | SEO técnico, structured data, sitemap |
| `composition-patterns` | React: compound components, refactor boolean props |
| `react-best-practices` | React 19/Next 16 performance: RSC, cache, memo |
| `supabase-postgres-best-practices` | Postgres: queries, RLS, índices, locks |
| `nodejs-best-practices` | Node.js: async, seguridad, arquitectura |
| `typescript-advanced-types` | TS avanzado: generics, utility types |

## Código

```
src/
├── app/          # Rutas expo-router ((tabs)/Inicio, Citas, Gastos, Listas, Cumpleaños, Ajustes)
├── components/   # expenses/, ui/ (Button, Card, TextField, EmptyState)
├── constants/    # theme.ts (colores Dusk, espaciados)
├── context/      # AuthProvider, CasaProvider
├── hooks/        # useRealtimeCollection
└── lib/          # Lógica pura testeable: validation, date, finance, birthdays, format, api, supabase
```

`web/` — frontend Astro (AGENTS.md lo referencia; verificar existencia antes de usar).

## Infraestructura

| Ruta | Propósito |
|---|---|---|
| `supabase/schema.sql` | Esquema completo: tablas, RLS, triggers, realtime |
| `supabase/functions/send-email/` | Edge Function Deno: emails Resend (invitación casa, bienvenida, recordatorios, avisos presupuesto, cumpleaños). Deployada en prod v1 |
| `docs/micasa-agents-workflow.json` | Flujo de agentes (64L) |
| `docs/micasa-architecture.json` | Arquitectura del proyecto (49L) |
| `docs/oauth-google-pendiente.md` | Estado OAuth Google: pasos config dashboard, archivos, pendientes |
| `scripts/` | serve-demo.sh, notify-telegram.sh |
| `.github/workflows/` | CI/CD |

## Git reciente (últimos hits)

`feat(auth): email verify Vercel` → `feat(ui): login warm + error banner` → `fix(a11y): a11y audit` → `fix(security): audit findings` → `chore(deploy): Vercel static export`

241 tests, deploy en `micasa-demo.vercel.app`.