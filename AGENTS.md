# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Idioma

Responde siempre en español, salvo que el usuario pida explícitamente otro idioma.

# Security review per code block

After completing any block of code (feature, screen, api module, schema change, hook), invoke the `security-auditor` subagent (via the Task tool) to audit it before committing. The agent is read-only and applies the checklist in `.opencode/agents/security-auditor.md`.

Rules:
- Never mark the block done or commit until the auditor returns APROBADO or the findings are remediated.
- Send the auditor the specific files/lines changed so it focuses its review.

# Regla dura (no negociable)

Ningún bloque de código se da por terminado ni se commitea si el `security-auditor` devuelve **BLOQUEADO**. Si la auditoría falla, primero se corrigen los hallazgos y después se vuelve a auditar hasta obtener **APROBADO**.

# Git workflow

- Funcionalidades → rama propia `feat/<slug>` desde `master`, con `git worktree add` para paralelas. PR a `master` al terminar (verificado: build + typecheck + tests OK).
- Cambios pequeños (agentes `.opencode/`, docs, scripts, config, fixes menores) → commit directo en `master`.
- PRs vía GitHub API con token de `~/.config/gh/hosts.yml` (curl + Bearer, `gh` no instalado).
