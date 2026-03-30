# CLIC-POS — contexto para agentes (Codex, Cursor)

## Qué es este repo

Frontend POS (Vite/React) con shell Android vía Capacitor; SQLite nativo en APK.

## Dónde trabajar (obligatorio para APK firmado)

| Objetivo | Ubicación |
|----------|-----------|
| Código, features, PRs | **Repo principal** `.../CLIC-POS` o worktree **limpia** desde `develop`. |
| **Solo** build release **firmado** | **Worktree canónica** `.../_worktrees/CLIC-POS/CLIC-POS-mobile-sqlite`. |
| Respaldo histórico / sucio | `.../_worktrees/CLIC-POS/CLIC-POS-mobile-sqlite-legacy-dirty` — **no compilar**; solo rescate con diff/cherry-pick. |

La worktree canónica **no** es lugar de desarrollo: solo recibe diffs ya validados para compilar un release. Detalle paso a paso: [docs/APK_RELEASE_CHECKLIST.md](./docs/APK_RELEASE_CHECKLIST.md).

## Ramas

- Base habitual: **`develop`**; ramas `fix/*`, `feat/*`, `codex/*` según PR.
- Una misma rama no puede estar en dos checkouts a la vez; alinear código antes de release (merge, cherry-pick o copia acotada de archivos).

## Versión Android

`android/app/build.gradle`: `versionCode` monotónico. Tras cada release, `build.gradle` + `output-metadata.json` + repo principal deben quedar coherentes; **nunca** bajar la versión.

## Lecturas

- [docs/APK_RELEASE_CHECKLIST.md](./docs/APK_RELEASE_CHECKLIST.md) — flujo canónico completo.
- [docs/ANDROID_APK_SQLITE.md](./docs/ANDROID_APK_SQLITE.md) — notas SQLite / APK.
