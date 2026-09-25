---
name: micasa-git
description: Buenas prácticas de git para el repo MiCasa. Usar ANTES de cualquier commit, push, merge, rebase, cherry-pick, reset o limpieza de ramas y worktrees. Cubre el flujo obligatorio de worktree por rama, los comandos destructivos que ya han causado pérdida de trabajo en este repo, y las rarezas de sus ramas (develop es la de trabajo, master es la de dependabot).
user-invocable: false
allowed-tools: Bash(git status*), Bash(git diff*), Bash(git log*), Bash(git add*), Bash(git commit*), Bash(git fetch*), Bash(git pull*), Bash(git push*), Bash(git branch*), Bash(git worktree*), Bash(git rebase*), Bash(git cherry-pick*), Bash(git restore*), Bash(git stash*), Bash(git checkout*), Bash(git switch*), Bash(gh pr*), Bash(gh run*), Read, Grep, Glob, TodoWrite
---

# Git en MiCasa

Skill de git **específica de este repositorio**. Las skills globales (`git-commit`, `git-push`…) explican cómo se usa git; esta explica cómo se usa git **aquí**, con las trampas que ya han mordido.

## Las dos ramas, y por qué importa

| Rama | Papel | Quién escribe |
|---|---|---|
| `develop` | La de trabajo. Todo lo que se despliega sale de aquí. | Personas y PRs manuales |
| `master` | La de por defecto del repositorio. | **Dependabot**, y casi nada más |

`develop` va muy por delante. En el momento de escribir esto, 36 commits por delante y 3 por detrás.

**Consecuencia práctica**: todo PR de dependabot se abre contra `master`. Si lo mergeas, el cambio **no llega a `develop`** y no se despliega. Ya ha pasado con el bump de jest (#42): mergeado en `master`, invisible en `develop`, y hubo que volver a hacerlo a mano (#56).

## Flujo obligatorio

1. `git checkout develop` en el directorio principal y `git pull --ff-only`
2. Crear rama desde `develop`: `git worktree add ../MiCasa-<nombre> -b <tipo>/<nombre> develop`
3. Trabajar **dentro del worktree**, nunca en `/home/richard/MiCasa`
4. Al terminar y pasar security + QA: commit, push, PR contra `develop`
5. Mergear, y **solo entonces** limpiar:
   ```bash
   git worktree remove /home/richard/MiCasa-<nombre>
   git branch -d <rama>
   ```

`develop` y `master` no se escriben directamente. Ni hotfixes ni cambios de documentación.

## Comandos que aquí han roto trabajo

### `git reset --hard` y `git checkout -f` — **el peor offender**

`checkout -f` y `reset --hard` descartan cambios locales **sin commit y sin aviso**, y en `develop` puede haber trabajo de otra persona.

Ya ha pasado: un `reset --hard origin/develop` borró una modificación de `app.json` que era de otro y que el propio repo advertía en `AGENTS.md` que no había que tocar. Se perdió un `android.package`, un `extra.eas.projectId` y un `owner`, y no había copia local.

**Antes de cualquiera de los dos**: `git status --porcelain`. Si no está limpio, no sigas. Y si el cambio es de otra persona, ni committing ni descartarlo: dejarlo y preguntar.

Alternativa: `git stash push -u -m "motivo"` y `git stash pop`, que siempre se puede recuperar.

### `git pull` que no avanza

`git pull` puede imprimir líneas del merge y dejar `HEAD` donde estaba. **No des por hecho que avanzó**: compruébalo con `git rev-list --count HEAD..origin/develop` después de un `fetch`. Si no es 0, el pull no funcionó.

### `git cherry-pick` que corrompe `package.json`

Un cherry-pick de un commit que toca `package.json` puede dejar el fichero a medias, con JSON inválido y claves duplicadas. Si pasa: `git cherry-pick --abort` y `git checkout -f <rama>`, y rehaz el cambio a mano editando el JSON, no con cherry-pick.

### `git push --force`

Solo con `--force-with-lease`. Nunca `--force` a secas: si alguien ha pusheado mientras tanto, lo sobrescribes sin enterarte.

## Antes de cada commit

```bash
git status -s        # qué hay, incluido lo que no esperabas
git diff             # el contenido real, no solo los nombres
git log --oneline -10  # el estilo de mensajes reciente
git add <archivos>  # NUNCA `git add -A` a ciegas
```

Tres cosas que hay que mirar específicamente:

- **`.gitignore` y symlinks.** `node_modules/` con barra no cubre un symlink, que es como se enlazan las dependencias entre worktrees para no reinstalar. Con `git add -A` se te cuela un symlink con una ruta absoluta de tu máquina. Hay una entrada `node_modules` sin barra por eso.
- **`app.json`.** La rama `develop` lleva una modificación de `app.json` que es de otra persona y no debe commitearse ni descartarse. Si aparece en `git status`, déjala como está.
- **Ficheros generados**: `dist/`, `sw-bundle.js`, `node_modules`.

## Antes de abrir un PR

`develop` se mueve solo. Si tu rama se quedó atrás, el PR sale `CONFLICTING` aunque tus cambios estén bien:

```bash
git fetch origin
git rebase origin/develop
git push --force-with-lease
```

Resuelve los conflictos **a mano y con criterio**: `docs/estado-proyecto.md` es una bitácora, y al fusionar dos sesiones lo correcto es quedarse con las dos, no quedarse con una. Si el conflicto es en un fichero de datos o de config, para y pregunta.

## El deadlock de la protección de ramas

`develop` exige **una revisión aprobatoria**, y el repositorio tiene `allow_auto_merge = false`.

- Un bot no puede aprobar su propio PR: *"Review Can not approve your own pull request"*.
- `--auto` falla con *"Auto merge is not allowed for this repository"*.
- La única vía es que **apruebe una persona**, o que el usuario autorice explícitamente `--admin`.

No lo das por hecho: pregunta antes de saltarte una protección de rama.

## limpieza

Cuando termines, no dejes worktrees ni ramas:

```bash
git worktree list
git fetch --prune
git branch -r --merged origin/develop   # candidatas a poda
```

Antes de borrar una rama remota, comprueba que **ningún PR abierto** la usa, y que no es `develop` ni `master`. Cada worktree con `node_modules` propio ocupa alrededor de 1 GB.

## Documentación

`docs/estado-proyecto.md` es la bitácora de sesión: se actualiza al cerrar cada bloque, con merges, despliegues, decisiones y lo que queda pendiente. `INDEX.md` se actualiza cuando se crea, modifica o borra cualquier `.md`.
