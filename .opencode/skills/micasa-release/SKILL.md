---
name: micasa-release
description: Pipeline completo de release de MiCasa. Usar cuando el usuario pida subir, commit+PR, mergear y desplegar, o un release completo. Encadena precondiciones, gates, commit, push, PR contra develop, checks, merge, limpieza y deploy verificado.
user-invocable: true
allowed-tools: Bash(git status*), Bash(git diff*), Bash(git log*), Bash(git add*), Bash(git commit*), Bash(git fetch*), Bash(git pull*), Bash(git push*), Bash(git branch*), Bash(git worktree*), Bash(git rev-list*), Bash(git ls-files*), Bash(git switch*), Bash(gh pr*), Bash(gh run*), Bash(npx tsc*), Bash(npx expo lint*), Bash(npx jest*), Bash(npx vercel*), Bash(npm run*), Bash(curl*), Bash(export VERCEL_TOKEN=*), Read, Edit, Grep, Glob, TodoWrite
---

# Release en MiCasa

Pipeline único: **gates → commit → push → PR → checks → merge → limpieza → deploy → verificación**.
Cada paso se completa antes del siguiente. Si algo falla, se para y se corrige; no se anota como pendiente.

Reglas de git del repo: cargar también `.opencode/skills/micasa-git/SKILL.md`. `AGENTS.md` manda si hay conflicto.

## 0. Precondiciones — parar si falla

```bash
git status --short --branch
git worktree list
gh pr list --state open
git branch --show-current
```

- Rama actual **distinta** de `develop` y `master`.
- Base **`develop`**.
- Solo `/home/richard/MiCasa` en `develop` abierto: ningún worktree extra, ningún PR abierto, ninguna rama local pendiente.
- Árbol limpio salvo los cambios del bloque actual.

Si no se cumple: parar, cerrar lo abierto (PR mergeado o cerrado con motivo, worktree eliminado, rama borrada) y volver.

## 1. Worktree

```bash
git worktree add ../MiCasa-<rama> -b <tipo>/<rama> develop
```

Trabajar **solo** dentro del worktree. `/home/richard/MiCasa` se queda en `develop`, intacto.
Si faltan dependencias: enlazar `node_modules` del directorio principal (symlink), no reinstalar 1 GB.

## 2. Gates — antes de commit

```bash
npx tsc --noEmit
npx expo lint
npx jest --runInBand
npm run verify:pwa      # solo si toca web o service worker
npm run verify:deps
npm run check:functions && npm run test:functions   # solo si toca Edge Functions
git diff --check
git ls-files | grep '\.env'   # solo .env.example
```

Si algo falla: corregir y repetir. **Prohibido commitear con gates rojos.**
Además: `security` en **APROBADO** y `qa-test` en **PASA** antes de commit. Si el bloque es solo documentación y entra en la excepción de `AGENTS.md`, omite gates de código y auditorías; el resto del flujo sigue igual.

## 3. Commit

```bash
git status -s
git diff
git log --oneline -10
git add <archivos explícitos>   # NUNCA git add -A
git commit -m "tipo(scope): resumen"
```

Conventional commits (`feat`, `fix`, `docs`, `chore`, `refactor`, `test`). Sin `--amend` salvo petición expresa.
No colar `dist/`, `sw-bundle.js`, `node_modules` ni symlinks.

## 4. Push

```bash
git push -u origin <tipo>/<rama>
```

Nunca `--force`. Si hay que rebasar: `--force-with-lease` solo si es tu rama y no hay PR revisado.

## 5. PR

```bash
gh pr create --base develop --title "tipo(scope): resumen" --body "<body>"
```

Body obligatorio: qué cambia, cómo se verificó (gates), veredicto de `security`/`qa-test` y pendientes.
Nunca `--base master`.

## 6. Checks

```bash
gh pr checks <n> --watch
```

Si falla: parar, corregir en el worktree, commit + push, repetir.

## 7. Merge

```bash
gh pr merge <n> --squash --delete-branch
```

La protección de `develop` exige revisión humana y `allow_auto_merge = false`.
`--admin` **solo** si el usuario lo autorizó explícitamente en esta conversación. Si no, pedir autorización y esperar.

## 8. Limpieza

Desde `/home/richard/MiCasa`:

```bash
git worktree remove /home/richard/MiCasa-<rama>
git branch -d <rama>
git fetch --prune
git worktree list
gh pr list --state open
```

Ambas listas deben salir limpias. Si el PR no se pudo mergear: cerrarlo con el motivo, no dejarlo «pendiente».

## 9. Deploy web

Solo desde `develop` ya mergeado y desde el directorio principal:

```bash
git switch develop
git pull --ff-only
git rev-list --count HEAD..origin/develop   # debe ser 0
npm run build:web
npm run verify:pwa
export VERCEL_TOKEN=$(sed -n 's/^export VERCEL_TOKEN="\(.*\)"$/\1/p' ~/.bashrc)
npm run deploy:vercel
curl -s -o /dev/null -w "%{http_code}\n" https://micasa-demo.vercel.app
```

- Token: leer la nota privada `~/.config/opencode/notas/micasa-deploy.md`. **Nunca** copiarlo al repo, a un log ni a un comando que lo imprima.
- Deploy **manual**: no hay integración git. `dist/` viejo prohibido: `build:web` siempre antes.
- Esperado `200`. Cualquier otro código: parar y revisar logs de Vercel.

## 10. Edge Functions (si cambió alguna)

Sin token de Supabase en la máquina: `supabase functions deploy` no sirve. Usar el tool MCP `deploy_edge_function` siguiendo la nota privada:

- `project_id` de la nota, `entrypoint_path: index.ts`, `import_map_path: deno.json`.
- `files` con nombres planos (`index.ts`, `handler.ts`, `cors.ts`, `reminders.ts`, `deno.json`); tests no se suben; todos en la misma llamada.
- `verify_jwt: false` para `send-web-push` (pg_cron llama sin JWT). `verify_jwt: true` para `send-email`.
- Verificar CORS de `send-web-push` con `OPTIONS` (204 permitido, 403 denegado) y `POST` sin `Origin` → 401.

## Prohibiciones

- `master` como destino de PR o merge.
- `git push --force` (solo `--force-with-lease` en rama propia).
- Deploy desde una rama sin mergear.
- Commit o merge con gates rojos, `security` ≠ APROBADO o `qa-test` ≠ PASA.
- Escribir en `/home/richard/MiCasa` durante un feature.
- Secretos en el repo, en CI YAML o en la conversación.
- Asumir auto-deploy tras push.

## Paradas

- `security` ≠ APROBADO o `qa-test` ≠ PASA.
- PR o worktree abiertos de un bloque anterior.
- Directorio principal sucio o fuera de `develop`.
- Deploy sin merge previo.
- Checks de PR en rojo.
- Health check distinto de `200`.

## Enlaces

- Git del repo: `.opencode/skills/micasa-git/SKILL.md`
- Reglas y gates: `AGENTS.md`
- Índice y mapa de docs: `INDEX.md`
- Tokens y Edge Functions: `~/.config/opencode/notas/micasa-deploy.md` (privada, fuera del repo)
