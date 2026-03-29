# Checklist operativo — APK release firmado (CLIC-POS)

Guía para mejoras del APK móvil: dónde editar, dónde firmar, versión y validación.

## Rutas de referencia

| Rol | Ruta |
|-----|------|
| **Repo principal (solo código)** | `/Users/felixdiaz/.gemini/antigravity/playground/tensor-planetoid/CLIC-POS` |
| **Worktree firmado (único sitio de release)** | `/Users/felixdiaz/.gemini/antigravity/playground/tensor-planetoid/_worktrees/CLIC-POS/CLIC-POS-mobile-sqlite` |
| **Salida APK release** | `<worktree>/android/app/build/outputs/apk/release` |
| **Metadata del último build** | `<worktree>/android/app/build/outputs/apk/release/output-metadata.json` |

En otros equipos, sustituye la parte base por tu clon; el worktree firmado debe ser el checkout que contiene `key.properties` y el keystore (ver abajo).

---

## Checklist

1. **Trabajar código solo** en el repo principal (`CLIC-POS`).

2. **No compilar release firmado** desde el repo principal si ahí no está la configuración de firma completa. El **APK release firmado se genera siempre** desde el worktree `CLIC-POS-mobile-sqlite`.

3. **Antes de compilar**, copiar al worktree firmado **únicamente los archivos modificados** respecto al trabajo en el principal (por ejemplo: `git diff --name-only` en el repo principal y copiar esas rutas al worktree).

4. **Firma válida** (solo en el worktree firmado; no mover ni borrar el keystore):
   - `android/key.properties`
   - `android/keys/clic-pos-release.keystore`

5. **Contador de versión** — no restaurar hacia atrás:
   - Tras decidir la nueva versión, actualizar `android/app/build.gradle` (`versionCode`, `versionName`) en el worktree y **dejarlo persistido**.
   - Confirmar coherencia con `output-metadata.json` tras el build.
   - Si `build.gradle` y `output-metadata.json` difieren, usar `max(versionCode)` entre ambos y sumar 1 para el siguiente release.

6. **Compilación en el worktree firmado** (en orden):

   ```bash
   npm run build
   npx cap sync android
   cd android
   ./gradlew clean assembleRelease
   ```

7. **Verificar firma del APK**:

   ```bash
   apksigner verify --print-certs <ruta-al.apk>
   ```

   Firma esperada (subject del certificado):

   `CN=CLIC POS, OU=Mobile, O=CLIC POS, L=Santo Domingo, ST=Distrito Nacional, C=DO`

   Si `apksigner` no está en el `PATH`, suele estar en  
   `$HOME/Library/Android/sdk/build-tools/<versión>/apksigner`.

8. **APK release** en la carpeta de salida del worktree (punto “Rutas de referencia”).

9. **Validar en dispositivo físico**:
   - Login vertical y horizontal
   - Activación de terminal
   - Ventas móvil
   - Catálogo móvil
   - Edición masiva móvil

10. **Git**:
    - Crear rama desde `develop`
    - Commits pequeños con [Conventional Commits](https://www.conventionalcommits.org/)
    - Abrir PR hacia `develop`

---

## Orden sugerido (copia + versión + build)

1. Copiar archivos modificados al worktree.
2. Leer versión actual en `android/app/build.gradle` y, si existe, en `output-metadata.json`.
3. Subir **una** versión coherente (`versionCode` / `versionName`).
4. Ejecutar el flujo de compilación (paso 6).
5. Verificar APK, firma (paso 7) y que `build.gradle` + `output-metadata.json` reflejan la misma versión.
