# CLIC-POS — FUNCTIONAL FREEZE DESDE 1.1.405

A partir de la versión:

**CLIC-POS 1.1.405 / build 1405**

declarar esta versión como:

**PILOT FUNCTIONAL BASELINE**

La rama funcional queda congelada durante el período de PILOTO CLIENTE.

El objetivo ahora es preservar estabilidad y evitar regresiones.

## REGLA PRINCIPAL

NO realizar cambios funcionales, refactors, optimizaciones preventivas ni mejoras de arquitectura sobre código estable sin una causa concreta y autorizada.

A partir de este baseline:

**NO CAMBIAR CÓDIGO PORQUE "PUEDE MEJORARSE".**

Cambiar código únicamente cuando exista:

1. bug reproducible;
2. fallo operativo;
3. riesgo demostrado de integridad;
4. regresión;
5. requisito pendiente necesario para `PRODUCTION APPROVED`;
6. cambio funcional solicitado explícitamente.

---

# ÁREAS PROTEGIDAS

Considerar especialmente protegidos los caminos actualmente validados:

* login/PIN;
* lector global;
* foco del lector;
* búsqueda;
* carrito;
* cantidades;
* cálculo de venta;
* cobro;
* pago;
* mesas;
* cambio de mesa;
* locks;
* `LOCAL_UNLOCK`;
* Tickets;
* persistencia SQLite;
* Inbox;
* Outbox;
* sincronización SALE/PAY;
* recuperación después de reinicio;
* impresión validada;
* navegación Venta/Mesas/Tickets.

No modificar estos caminos incidentalmente mientras se investiga otro problema.

---

# PROHIBIDO DURANTE EL FREEZE

No realizar:

* refactors estéticos;
* reorganización de servicios;
* cambios de arquitectura no requeridos;
* optimizaciones especulativas;
* cambios de estado React sin necesidad demostrada;
* reemplazo de APIs porque exista una alternativa "mejor";
* cambios generales de SQLite;
* cambios generales de sincronización;
* cambios generales de Inbox/Outbox;
* cambios de timers sin evidencia;
* cambios para reducir CPU sin impacto operativo demostrado;
* cambios para reducir memoria sin crecimiento sostenido demostrado;
* cambios por micro-optimizaciones;
* limpieza masiva de código;
* actualización de dependencias no necesaria;
* cambios simultáneos en varios subsistemas.

No perseguir métricas por sí mismas.

CPU, RAM, FPS o latencia solo justifican cambios cuando exista impacto demostrado o cuando sean requisito explícito del gate de producción.

---

# PROCEDIMIENTO PARA CUALQUIER NUEVO BUG

Antes de modificar código:

## 1. REPRODUCIR

Documentar escenario exacto.

## 2. MEDIR

Obtener evidencia mínima necesaria.

## 3. IDENTIFICAR CAUSA

Indicar:

archivo
→ función
→ causa
→ impacto.

## 4. DEFINIR ALCANCE

Identificar exactamente qué código debe cambiar.

## 5. HOTFIX MÍNIMO

Modificar únicamente lo necesario.

## 6. REGRESIÓN

Volver a probar el camino afectado y los caminos protegidos relacionados.

## 7. COMPARAR

Entregar:

ANTES
→ CAMBIO
→ DESPUÉS.

No ampliar el alcance durante la implementación.

---

# REGLA DE CAMBIO MÍNIMO

Preferir:

1 bug
→ 1 causa
→ 1 fix
→ 1 PR.

Evitar combinar en un mismo PR:

bug

* refactor
* optimización
* limpieza
* feature.

Si durante un hotfix se descubre otra oportunidad de mejora:

DOCUMENTARLA.

NO implementarla automáticamente.

---

# BASELINE DE REGRESIÓN

Antes de aceptar cualquier nueva versión posterior a 1.1.405 comprobar como mínimo:

* login;
* lector sin tocar Buscar;
* lectura repetida aumenta cantidad sin duplicar línea;
* venta;
* cantidades;
* Mesas;
* cambio de mesa;
* Tickets;
* cobro;
* pago;
* impresión;
* persistencia;
* sincronización SALE/PAY;
* Outbox;
* SQLite;
* reinicio/recuperación.

Los fixes futuros NO pueden sacrificar comportamiento actualmente aprobado.

---

# PENDIENTES DE PRODUCCIÓN

El FUNCTIONAL FREEZE no impide trabajar en los pendientes ya documentados para `PRODUCTION APPROVED`.

Se permite investigar y, cuando exista evidencia, corregir:

* gate `standaloneMaster`;
* `orderTaker`;
* contratos/topologías pendientes;
* offline completo en la versión candidata;
* cierre Z;
* fiscal/e-CF;
* aplicación contable final;
* Heartbeat ERP;
* FPS/renderer;
* navegación p95/p99;
* estabilidad prolongada;
* indicador legacy `ERP ventas:NO`;
* presentación monetaria/promociones;
* escenarios adicionales de red/reintentos;
* topologías adicionales.

Pero aplicar la misma regla:

**MEDIR → IDENTIFICAR → CORREGIR → REGRESIÓN.**

No utilizar estos pendientes como autorización para refactorizar subsistemas completos.

---

# CASO ESPECIAL — INDICADOR LEGACY ERP

Si el indicador muestra:

`ERP ventas:NO`

mientras:

SALE = APPLIED
PAY = APPLIED
documento ERP = correcto
Outbox = limpio

NO modificar:

* SALE;
* PAY;
* Inbox;
* Outbox;
* reenvío;
* persistencia funcional.

Investigar y corregir únicamente la proyección/estado visual legacy responsable.

No reenviar transacciones para corregir un indicador.

---

# CASO ESPECIAL — CPU CLIENTE

La diferencia histórica de CPU Cliente/Master permanece como:

**KNOWN ISSUE / PENDING OPTIMIZATION**

No modificar código para reducir CPU mientras no exista evidencia de:

* degradación;
* thermal throttling;
* pérdida de FPS;
* latencia;
* crecimiento sostenido de memoria;
* impacto operativo.

Continuar midiendo si es necesario.

No optimizar especulativamente.

---

# CONTROL DE CAMBIOS

Para cualquier modificación posterior a 1.1.405, el reporte/PR debe incluir obligatoriamente:

**BASELINE:** 1.1.405

**MOTIVO DEL CAMBIO:**
bug / regression / production gate / explicit feature request

**SÍNTOMA:**

**CAUSA RAÍZ:**

**ARCHIVOS MODIFICADOS:**

**POR QUÉ ES NECESARIO:**

**RIESGO DE REGRESIÓN:**

**PRUEBAS EJECUTADAS:**

**ANTES:**

**DESPUÉS:**

Si estos campos no pueden completarse, no modificar el baseline.

---

# VERSIONADO

1.1.405 permanece como referencia funcional del PILOTO.

Las versiones posteriores deben ser incrementales respecto de este baseline.

Si una nueva versión introduce una regresión:

NO intentar acumular parches indefinidamente sobre ella.

Comparar contra 1.1.405 y conservar la posibilidad de rollback.

---

# ROLLBACK

Mantener disponible:

* APK 1.1.405 firmada;
* SHA-256;
* commit;
* configuración de build;
* reporte QA;
* procedimiento de instalación.

Si una versión posterior genera una regresión comercial:

detener promoción.

Determinar si procede volver al baseline 1.1.405 mediante el procedimiento seguro existente, preservando datos y verificando compatibilidad de esquema antes de cualquier downgrade.

Nunca realizar downgrade de datos/esquema automáticamente.

---

# PILOTO CLIENTE

Durante el piloto:

priorizar observación sobre modificación.

Si el cliente reporta un problema:

REPRODUCIR
→ CLASIFICAR
→ MEDIR
→ DECIDIR.

Clasificar cada incidencia como:

CRITICAL
HIGH
MEDIUM
LOW
COSMETIC.

CRITICAL/HIGH:
investigar inmediatamente.

MEDIUM:
evaluar impacto antes de modificar.

LOW/COSMETIC:
documentar para siguiente ciclo salvo autorización explícita.

---

# PRINCIPIO DEL PILOTO

La estabilidad tiene prioridad sobre la optimización.

La versión 1.1.405 ya constituye una base funcional validada.

A partir de ahora:

**NO BUSCAR QUÉ MÁS CAMBIAR.**

Buscar únicamente:

**QUÉ FALLA, QUÉ FALTA PARA PRODUCCIÓN O QUÉ HA SIDO SOLICITADO EXPLÍCITAMENTE.**

Si no existe evidencia de un problema:

**NO MODIFICAR EL CÓDIGO.**


---

# Identificación del baseline preservado

Declaración del usuario: 18 de septiembre de 2026. La clasificación funcional del piloto no sustituye el gate general ni constituye PRODUCTION APPROVED.

- Versión: **1.1.405 / build 1405**.
- Commit oficial `develop`: `3fae0de079d0b12e2943b2712a06c47fc73c0ace`.
- PRs integrados del piloto: 736, 737 y 738.
- APK: `Clic-Pos-1.1.405-release.apk`.
- SHA-256: `7fea820f7a4146b79c35a04fd92413ed01645d2c62f974d1b4d090079d730fdc`.
- Certificado SHA-256: `17746ded8c0d08a839ac5c3e84903b46c6f537f798d053a94e021355af188e2c`.
- Tamaño: 33,389,493 bytes.
- [APK firmada preservada en Cloud-admin Blob](https://eebdpo1dt5z473bb.public.blob.vercel-storage.com/Clic-Pos-1.1.405-release.apk), registrada como Beta / PILOTO CLIENTE; no usar el enlace mutable `latest` para identificar este baseline.
- Build: release, `DEBUG=false`, `POS_DIAGNOSTICS=false`, HTTP LAN habilitado; sin diagnóstico pesado continuo.
- Procedimiento seguro: [APK_RELEASE_CHECKLIST.md](./APK_RELEASE_CHECKLIST.md). El rollback requiere comprobar compatibilidad de esquema y preservación de datos antes de decidir el procedimiento; no usar un downgrade automático.
- Directorio canónico de evidencia del release: `android/app/build/outputs/apk/release/` en la worktree firmada descrita en `AGENTS.md`. Conserva `release-report-1.1.405.txt`, `release-gate-1.1.405.json`, `packaged-assets-1.1.405.json` y `output-metadata-1.1.405.json`.
- Subdirectorio `pilot-1.1.405/`: `REPORTE-ENTREGA.md`, evidencia del gate general, resultados SQLite/Outbox/ERP, confirmación de impresión, muestras de rendimiento y registro Cloud-admin. Contiene documentación y evidencias; el APK permanece en el directorio padre `release/`.

El gate general `qa:release-promote` sigue **NO APROBADO**; su primera condición pendiente es `standaloneMaster`. No convertir métricas no disponibles en cero ni contratos/topologías no observados en aprobados. CPU Cliente, proyección legacy ERP y presentación monetaria conservan el tratamiento de known issues ya documentado. Los pendientes de producción permiten investigar y corregir con evidencia, sin ampliar automáticamente el alcance.
