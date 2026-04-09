# Historial de APK release (referencia)

Registro de builds **release firmados** validados. El código fuente de referencia sigue siendo `develop`; esta tabla documenta el artefacto y el contexto de build.

---

## 1.0.298 (versionCode 298) — 2026

| Campo | Valor |
|--------|--------|
| **APK** | `Clic-Pos-1.0.298-release.apk` |
| **Metadata** | `output-metadata.json` |
| **versionCode** | 298 |
| **versionName** | 1.0.298 |
| **Rama de build** | `hotfix/apk-1.0.298-handheld-reception` |
| **Commit build** | `16857c3bc457fc723249a5a6fdae467a3ba55103` |
| **Worktree usada** | `/Users/felixdiaz/.gemini/antigravity/playground/tensor-planetoid/_worktrees/CLIC-POS/CLIC-POS-mobile-sqlite` |
| **SHA-256** | `cd44d9fb8f2e8cdecb864c35a796e54044c4026bdd69c2c4fe61813996ebc200` |
| **Firma release** | Válida (`CN=CLIC POS, OU=Mobile...`) |

### Verificación ejecutada

- **POS worktree:** `npm run build` — OK
- **ERP worktree:** `npm run build` — OK
- **APK checks:** `npx tsc -b`, `npm run build`, `npx cap sync android`, `./gradlew clean assembleRelease` — OK

---

## 1.0.297 (versionCode 297) — 2026

| Campo | Valor |
|--------|--------|
| **APK** | `Clic-Pos-1.0.297-release.apk` |
| **Metadata** | `output-metadata.json` (junto al APK en el directorio de release) |
| **versionCode** | 297 |
| **versionName** | 1.0.297 |
| **PR del fix / bump** | #131 y #132 |
| **Merge en `develop`** | `83f8d8b84b098967ab1068ced05da962861a8ec5` |
| **Commit bump** | `9da9eff` |
| **Rama de build** | `hotfix/apk-1.0.297-license-subscription-select` |
| **Worktree usada** | `/Users/felixdiaz/.gemini/antigravity/playground/tensor-planetoid/_worktrees/CLIC-POS/CLIC-POS-mobile-sqlite` |
| **SHA-256** | `9ec5c20a0a4d5a18610eebd364493d9f67f10225240c5c172ccc0534b3018c55` |
| **Firma release** | Válida |
| **Certificado** | `CN=CLIC POS, OU=Mobile, O=CLIC POS, L=Santo Domingo, ST=Distrito Nacional, C=DO` |

### Verificación de build (misma línea que produjo el APK)

- `./node_modules/.bin/tsc -b` — OK  
- `npm run build` — OK  
- `npx cap sync android` — OK  
- `./gradlew clean assembleRelease` — OK (warnings de Vite/Kotlin/Gradle esperados)

---

## 1.0.295 (versionCode 295) — 2026

| Campo | Valor |
|--------|--------|
| **APK** | `Clic-Pos-1.0.295-release.apk` |
| **Metadata** | `output-metadata.json` (junto al APK en el directorio de release) |
| **versionCode** | 295 |
| **versionName** | 1.0.295 |
| **PR del fix** | #128 |
| **Merge en `develop`** | `9b4849b22b075b27e0a94b4ac2221243c710c17d` |
| **Rama de build** | `hotfix/apk-1.0.295-warehouse-activation` |
| **Commit del build** | `f3f31d1` |
| **Worktree usada** | `/Users/felixdiaz/.gemini/antigravity/playground/tensor-planetoid/_worktrees/CLIC-POS/CLIC-POS-mobile-sqlite` |
| **SHA-256** | `6de6143fada1cbde2d4b6f2e775a0c962f1be354834518bccc47024d353c46a7` |
| **Firma release** | Válida |
| **Certificado** | `CN=CLIC POS, OU=Mobile, O=CLIC POS, L=Santo Domingo, ST=Distrito Nacional, C=DO` |

### Verificación de build (misma línea que produjo el APK)

- `./node_modules/.bin/tsc -b` — OK  
- `npm run build` — OK  
- `npx cap sync android` — OK  
- `./gradlew clean assembleRelease` — OK  

---

Para el flujo operativo (worktree, firma, checklist), ver [APK_RELEASE_CHECKLIST.md](./APK_RELEASE_CHECKLIST.md).
