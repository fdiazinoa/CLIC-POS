# CLIC-POS — contexto para agentes (Codex, Cursor)

## Qué es este repo

Frontend POS (Vite/React) con shell Android vía Capacitor; SQLite nativo en APK.

## Dónde trabajar (no confundir rutas)

| Objetivo | Ubicación |
|----------|-----------|
| Código, commits y PRs | **Repo principal** (este directorio). |
| APK **release firmado** (keystore) | **Worktree** `_worktrees/CLIC-POS/CLIC-POS-mobile-sqlite` en la misma máquina de build. |

Detalle operativo: [docs/APK_RELEASE_CHECKLIST.md](./docs/APK_RELEASE_CHECKLIST.md).

## Ramas

- Base habitual: **`develop`**. Las ramas **`fix/*`** y **`feat/*`** (o `codex/*`) son para PRs; el nombre describe el cambio.
- **Git no permite** tener la **misma** rama checked out en dos sitios a la vez. Si el worktree firmado usa otra rama que el principal, es normal: alinea código con merge, cherry-pick o **rsync de archivos** según el checklist antes de `assembleRelease`.
- Antes de un release: confirma que el worktree tiene el mismo código que la rama que vas a integrar (revisa diff frente a `origin`).

## Versión Android

En `android/app/build.gradle`, **`versionCode`** debe subir en cada subida a Play (monotónico). Después de un release firmado, mantén **alineados** `versionCode` / `versionName` en el repo principal y en el worktree firmado.

## Lecturas útiles

- [docs/APK_RELEASE_CHECKLIST.md](./docs/APK_RELEASE_CHECKLIST.md) — flujo build + firma + verificación.
- [docs/ANDROID_APK_SQLITE.md](./docs/ANDROID_APK_SQLITE.md) — notas SQLite / APK (si aplica a tu tarea).
