# Checklist operativo — APK release firmado (CLIC-POS)

Flujo **canónico** para compilar releases firmados reproducibles y mantener la base de build limpia.

## Rutas (esta máquina)

| Rol | Ruta | Uso |
|-----|------|-----|
| **Repo principal** (código, PRs) | `/Users/felixdiaz/.gemini/antigravity/playground/tensor-planetoid/CLIC-POS` | Desarrollo y validación. |
| **Worktree canónica de build firmado** | `.../_worktrees/CLIC-POS/CLIC-POS-mobile-sqlite` | **Única** ruta válida para `assembleRelease` firmado. |
| **Worktree archivada (no canónica)** | `.../_worktrees/CLIC-POS/CLIC-POS-mobile-sqlite-legacy-dirty` | Solo respaldo histórico; **no** compilar aquí. |
| **Salida APK release** | `<worktree canónica>/android/app/build/outputs/apk/release` | Donde debe quedar el APK. |
| **Salida APK debug** | `<worktree canónica>/android/app/build/outputs/apk/debug` | Misma convención de nombres que `build.gradle`. |
| **Metadata post-build** | `.../release/output-metadata.json` | Debe coincidir con la versión en `build.gradle`. |

En otros equipos, sustituye la base del path; las **reglas** (canónica vs legacy, no mezclar WIP) son las mismas.

---

## Reglas importantes

- **No** compilar release desde el repo principal si no tiene firma completa (`key.properties` + keystore).
- **No** usar `CLIC-POS-mobile-sqlite-legacy-dirty` para compilar; solo para rescatar cambios con diff aislado o cherry-pick, nunca copiar el árbol entero a ciegas.
- La worktree canónica **no** es para desarrollar features: solo recibe cambios ya validados y concretos para ese release.
- **No** bajar `versionCode` / `versionName` a números viejos; mantener monotonía (Play Store y trazabilidad).

---

## Firma (solo en worktree canónica)

Deben existir (y no perderse):

- `android/key.properties`
- `android/keys/clic-pos-release.keystore`

---

## Flujo exacto (orden)

### 1. Desarrollar y validar (fuera de la worktree canónica)

Trabajar en el **repo principal** o en una worktree/rama **limpia** derivada de `develop`.

### 2. Validar antes de portar

- `npm run build`
- Pruebas puntuales / smoke test según el cambio

### 3. Llevar solo ese diff a la worktree canónica

Copiar **únicamente** los archivos del cambio (por ejemplo: `git diff --name-only` en el origen y rsync/cp de esas rutas). No mezclar experimentos sin formalizar.

### 4. Leer versión actual

- `android/app/build.gradle` → `versionCode`, `versionName`
- Si existe: `android/app/build/outputs/apk/release/output-metadata.json` → confirmar última versión real del último APK generado

### 5. Incrementar versión (ejemplo)

En `android/app/build.gradle` de la **worktree canónica** (y reflejar lo mismo en el principal cuando integres):

- `versionCode` 163 → **164**
- `versionName` `"1.0.163"` → **`"1.0.164"`**

Si `build.gradle` y `output-metadata.json` difieren, usar `max(versionCode)` entre ambos y **sumar 1** para el siguiente release.

### 6. Compilar (solo en worktree canónica)

```bash
cd /ruta/a/CLIC-POS-mobile-sqlite
npm run build
npx cap sync android
cd android
./gradlew clean assembleRelease
```

Asegura `android/local.properties` con `sdk.dir` válido si Gradle lo pide.

### 7. Verificar firma

```bash
apksigner verify --print-certs <ruta-al.apk>
```

Subject esperado del certificado:

`CN=CLIC POS, OU=Mobile, O=CLIC POS, L=Santo Domingo, ST=Distrito Nacional, C=DO`

Si `apksigner` no está en `PATH`:  
`$HOME/Library/Android/sdk/build-tools/<versión>/apksigner`

### 8. Confirmar cierre

- El APK existe en `.../outputs/apk/release/`
- `output-metadata.json` refleja la **nueva** versión
- `build.gradle` queda **commiteado** (o al menos persistido de forma explícita) con esa versión
- **No** restaurar versión a un número anterior

---

## Checklist rápido (calidad)

- Login vertical y horizontal
- Activación de terminal
- Ventas móvil, catálogo, edición masiva (según alcance del release)

## Git

- Ramas desde `develop`; commits pequeños con [Conventional Commits](https://www.conventionalcommits.org/)
- PR hacia `develop`
- Tras release: alinear versión en principal y worktree canónica para el siguiente ciclo

---

## Rescate desde `legacy-dirty`

Solo con **parches acotados**: `git diff`, archivos sueltos, o `cherry-pick` de commits identificables. **Prohibido** sincronizar todo el estado sucio hacia la worktree canónica.
