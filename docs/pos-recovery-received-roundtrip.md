# Hito de laboratorio: recuperar y cerrar el conjunto recibido

## Resultado y límites

El recorrido integrado usa captura del POS, SQLite en disco, HTTP con el router ERP real, PostgreSQL 18.4 y `buildNativeZReportContent` del POS. Elimina únicamente la base temporal de origen y restaura en otra base. Los documentos comerciales APPLIED son fixtures explícitos; no se ejecutan ventas, cobros ni inventario. El asiento de cierre se crea solamente en PostgreSQL efímero.

Perfil positivo: dos TICKET COMPLETED, DOP/tasa 1, CASH sin cambio, renglones completos de 100 y 50, sin impuestos, descuentos ni crédito. Cruzan medianoche. No es un validador universal de todos los canales. El ERP debe bloquear la jornada completa ante operaciones o dependencias no soportadas, no filtrar filas. El respaldo conserva originales completos, pero este cierre de laboratorio tiene alcance estrecho.

Tras commit real: `COMMITTED`, `coverage=RECEIVED_ONLY`, `exactZEligible=false`, `closeAuthorization=GRANTED_RECEIVED_SCOPE`. Una operación NEVER_SENT se pierde con la base de origen y no aparece en la descarga; esto no certifica completitud del dispositivo. Legacy permanece UNKNOWN. Preparaciones/observaciones conservan NOT_GRANTED.

No se monta ReceivedCloseFlow en App ni se habilita la aceptación en el router de producción. Sin APK, dispositivo del cliente, migración remota, despliegue o merge. La UI de recuperación/cierre y su habilitación siguen pendientes; no presentar este hito como función disponible para el cliente.

## Recorrido comprobado

1. Capturar originales en SQLite mediante RecoveryDatabase y enviarlos con PendingOperationsRecovery por HTTP.
2. Sembrar resultados comerciales APPLIED y sus referencias exactas en PostgreSQL efímero; no ejecutar appliers.
3. Crear un original no enviado y eliminar la base temporal de origen.
4. Releer una terminal de laboratorio persistida, usando los helpers existentes de token y dispositivo del ERP. Rechazar new antes del cambio y old después. El cambio de credenciales/autorización es fixture; no demuestra aprovisionamiento ni pairing remoto.
5. Descargar snapshot auténtico del ERP, verificar e importar dos originales conservando IDs. NEVER_SENT ausente; recepción no se convierte en APPLIED local.
6. Preparar Z nativo desde los originales restaurados y configuración congelada; ERP verifica materiales, snapshot y configuración recibida.
7. Persistir observación/intención v2 y cuerpo exacto antes de submit. Conservar closeId/closeEventId/nextOpenSetId en reintentos.
8. ERP acepta una vez; descartar deliberadamente su ACK HTTP. POS sigue sin Z ni archivo local.
9. Consultar ACK durable. Rechazar seis mutaciones (estado, empresa, requestHash, reporte, número, closeId) y cambio de empresa de contexto.
10. Provocar fallo de SQLite al insertar Z: rollback de archivo, eliminación de activos y serie. ACK verificado queda persistido separadamente.
11. Reiniciar SQLite y publicar desde ese ACK sin un nuevo POST. Reporte único, dos documentos históricos, ningún activo y serie 2. Repetir tras reinicio conserva resultado.
12. ERP tiene un commit, un asiento, dos documentos comerciales y tres eventos inbox (dos ventas preexistentes + cierre). El POS no reenvía originales recuperados.

## Implementación POS

- ReceivedCloseFlow está aislado, sin montaje operacional. Persiste candidato, ACK y marca de publicación con hash. Consulta resultado antes de reintentar; HTTP 404 no autoriza efectos.
- Verifica alcance completo, intención, artifacts, closeControl, membresía, packetHash, registrationHash, recursos, solicitud y salidas report/summary/journal. Comprueba número/código contra serie observada.
- ClosePreparation.withCurrent usa la cola de almacenamiento existente y valida que las fuentes/configuración no cambiaron antes de publicar. Un cambio local bloquea publicación aunque haya ACK remoto; éste queda preservado para resolver el conflicto. Todavía no hay UI de resolución ni exclusión durable de nuevas operaciones durante descarga/commit.
- Una transacción SQLite archiva los miembros, elimina sólo esos activos, guarda Z, avanza contadores con max, conserva marca recuperada y fija el siguiente openSet técnico. No inventa una sesión de apertura.
- No imprime, no llama appliers y no cambia el cálculo nativo. La reimpresión futura usa la configuración habitual.

## Reproducción

Base POS: origin/develop c0be505. Incluye la actualización de prueba de configuración congelada de f5229df (PR #572) para consolidarla en este hito, sin necesitar otro merge separado. Dependencia ERP: rama feature/sync-recovery-laboratory-roundtrip basada en clean-erp; fijar commit entregado en el PR conjunto.

Node 24.11.1; PostgreSQL embebido 18.4. Los directorios siguientes son del laboratorio de desarrollo, no de producción:

```sh
CLIC_ERP_REVIEW_PATH=/Users/felixdiaz/.gemini/antigravity/playground/tensor-planetoid/CLIC-ERP-recovery-contract CLIC_EMBEDDED_POSTGRES_MODULE=/tmp/clic-original-pg-tests/node_modules/embedded-postgres/dist/index.js node --import tsx --test tests/recovery*.test.ts tests/closePreparation.test.ts tests/nativeZ*.test.ts
npm run build
npm run lint
```

El test integrado omite su ejecución si faltan las dos variables; un SKIP no cuenta como evidencia. La ejecución registrada debe tener cero skips. El bridge Android se adapta a node:sqlite: prueba la transacción del adaptador, no hardware Android.

Lint presenta el bloqueo previo de ESLint 9 sin eslint.config.*. Build conserva la advertencia previa de chunks grandes. No se cambia configuración ajena a esta tarea.

## Trabajo restante fuera de este hito

- Conectar flujo controlado de recuperación/cierre a UI y transporte operacional, con manejo visible de ACK aceptado/publicación local pendiente.
- Ampliar perfiles o bloquear explícitamente jornadas incompatibles; demostrar precisión/configuración efectiva de cada variante antes de habilitarla.
- Validar integración con esquema real y autorización/provisión real en entorno de pruebas; decidir despliegue de forma separada.
- Las pruebas POS no certifican custodia, retención remota, continuidad del dispositivo ni operaciones jamás recibidas. No ampliar autoridad por conteos coincidentes.
