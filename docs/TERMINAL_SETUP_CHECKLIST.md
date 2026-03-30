# Checklist — setup de terminales (CLIC-POS)

Objetivo: no romper activación/vínculo respetando **dos ejes independientes** (no inferir uno desde el otro).

## Ejes (siempre separados)

1. **`bindingMode` (rol):** `MASTER` | `SLAVE`
2. **`integrationMode`:** `LOCAL_ONLY` | `ERP_DIRECT`

En código/UI no se deduce `SLAVE` solo porque exista `masterIp`, ni `ERP_DIRECT` solo porque el tenant esté activado en Cloud.

---

## Matriz válida

| Rol | Integración | IP maestro | Origen del listado |
|-----|-------------|------------|---------------------|
| MASTER | LOCAL_ONLY | No | Terminales locales (setup / maestro local) |
| MASTER | ERP_DIRECT | No | Terminales del ERP (Android: proxy `/api/setup` → fallback ERP) |
| SLAVE | LOCAL_ONLY | Sí | Terminales desde la maestra local (`/api/setup` de esa IP) |
| SLAVE | ERP_DIRECT | — | **No soportado** como flujo operativo normal; la esclava no debe operar vinculada directo al ERP |

---

## Reglas UI

- El campo **IP del Master local** solo se muestra cuando `bindingMode === 'SLAVE'`.
- `MASTER + ERP_DIRECT` no debe mostrar pantalla/flujo de “IP del master”.
- `MASTER + LOCAL_ONLY` no debe mostrar errores atribuibles al ERP.

---

## Red / runtime (Android, `MASTER + ERP_DIRECT`)

Intentar en este orden:

1. Proxy local embebido: `GET/POST` bajo `/api/setup` (mismo host que sirve el POS en el WebView).
2. Fallback a llamadas directas al ERP (`erpTerminalSetup` / `/api/sync/...`).

Aplicar la misma idea a: listar terminales, bind, configuración inicial (cuando el flujo sea ERP en maestro).

---

## Persistencia

- No persistir binding “final” hasta completar takeover + config inicial correctamente.
- Si takeover o config fallan: rollback de terminal activa y de config inicial; permitir reintento.
- Evitar estado **medio vinculado** (no decir “ya vinculada” si el flujo quedó incompleto).

---

## Mensajes

Diferenciar:

- Error del **ERP**
- Error de la **maestra local** (red / IP / puerto)
- **Sin terminales** en el origen esperado
- Evitar **`Failed to fetch`** genérico si se puede sustituir por un mensaje anterior.

---

## Smoke tests obligatorios

1. **MASTER + ERP_DIRECT:** activar empresa → listar terminales ERP → vincular → login/config.
2. **MASTER + LOCAL_ONLY:** no pide IP maestro → lista locales.
3. **SLAVE + LOCAL_ONLY:** pide IP → lista desde maestra → vincula sin depender del ERP directo.
4. **Falla de takeover:** permite reintentar; no mensaje de “ya vinculada” si quedó incompleto.

---

## No hacer

- No inferir `SLAVE` solo por `masterIp`.
- No inferir ERP solo por tenant activado en Cloud.
- No mezclar flujo local y ERP en una sola condición ambigua.

---

## Implementación de referencia

Lógica de listado/bind en `components/TerminalSelector.tsx`; llamadas ERP directas en `services/setup/erpTerminalSetup.ts`; proxy `/api/setup` en `server/routes/setupRoutes.ts`.
