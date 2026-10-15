# RETURN/VOID: autorización ERP `return_context` v1

Esta extensión sustituye el tratamiento de RETURN/VOID documentado inicialmente para PR2250. Fuente: [ERP PR2251](https://github.com/fdiazinoa/CLIC-ERP/pull/2251), commit `40c847dbda321ba3573dd49a8fe45410b1571b46`, rama `fix/sync-format-return-context`, `docs/ARTICLE_FORMATS_POS_NETWORK_V1.md`. El contrato comercial, SALE, sesiones V3 y rutas permanecen en sus versiones existentes. Consultar un PR merged no demuestra despliegue ni SQL aplicado en Supabase.

## Negociación

`createFormatTransport` sólo envía `x-article-formats-return-context: 1` en el POST de negociación cuando el llamador pide expresamente `negotiateReturnContextV1:true`. No lo añade a POST de eventos ni delante de replay histórico. El ERP verifica capability PERSISTIDA `article_formats_return_context=1` y readiness privado `return_context_version:1`; el POS no crea ni cambia esos valores.

La respuesta SALE-only (`return_context_supported:false`, contexto/política null, `event_types` sólo SALE) es válida para maestros y ventas. Un servidor anterior que devuelve sólo política/revisión no autoriza nuevos RETURN/VOID. No se calcula el fingerprint ni se fabrica una referencia a partir del maestro o de una venta.

Para un retorno nuevo se exige negociación completa v1 y un `return_context` del evento exactamente igual al descriptor emitido por ERP: schema_version, id, grant_revision, fingerprint y return_policy. El echo de política corresponde al registro servidor; el POS no puede escoger otra política. SALE prohíbe el campo.

## Commit y envío

El objeto se guarda dentro del contenido original del Outbox y del documento wire, junto al contexto negociado completo, en el **mismo executeSet SQLite** que documento/líneas, pagos, secuencias, stock BASE, Kardex y diario. Se reutilizan las tablas preparadas; no hay columna duplicada ni backfill de autorizaciones.

El efecto físico local se obtiene de `event.return_context.return_policy`, después de validar igualdad con el descriptor negociado, y no de la política de la venta o de una negociación posterior. RESTOCK aumenta BASE y revierte COGS; DAMAGED/NO_RETURN no aumentan stock vendible y conservan COGS. Historia y límites originales permanecen congelados.

El drain lee el evento durable original y lo envía tal cual. No consulta negotiate durante retry. Tampoco cambia el contexto si el runtime ahora tiene otro grant o política. Se conservan event_id, transaction_id, line_id, payment_id, hash y contenido originales.

## ACK

Además de los campos/hash/movimientos anteriores, un evento ligado exige `return_authorization`:

- schema_version/id/grant_revision/fingerprint/return_policy iguales exactamente a los cinco valores originales guardados;
- admission_grant_revision positivo y admission_fingerprint válido;
- recovery_id explícitamente null si no hubo recuperación: en ese caso ambos admission_* coinciden con los originales;
- si los admission_* cambian, recovery_id debe ser un UUID de recuperación explícita del servidor. La política original nunca cambia.

HTTP200/applied:true, un hash correcto o un número correcto de movimientos no sustituyen esta comprobación. Si falta o contradice la autorización, el evento se mantiene pendiente en HOLD y se registra la inconsistencia. Sólo un ACK completo y validado se guarda, junto al estado Outbox y documento, en la transacción de confirmación.

Un APPLIED histórico sin return_context conserva su ACK anterior sin exigir ni fabricar return_authorization. Un pendiente antiguo sin contexto no puede contabilizarse como retorno nuevo: se conserva y el ERP lo rechaza para conciliación autorizada, sin agregarle una referencia actual.

## Conflicto y recuperación

`POS_FORMAT_RETURN_CONTEXT_CONFLICT` (409, retryable:false, recovery_required:true, outbox_action:RETAIN_ORIGINAL) detiene el retry automático. REQUIRED/INVALID/FORBIDDEN también conservan el original. Un retryable inconsistente no permite reintentar automáticamente un conflicto de contexto conocido.

El POS mantiene el stock ya comprometido localmente como operación pendiente; no lo revierte en silencio, no reemplaza contexto/política/IDs, no reescribe contenido y no envía el evento a legacy. Volver a negociar o restaurar el nombre RESTOCK no basta para resolver la revisión/fingerprint.

La recuperación sideband es una operación ERP privada de DBA/propietario autorizada expresamente y externa al POS. Esta entrega no añade una ruta, privilegio ni llamada POS a `private.pos_format_approve_return_recovery`. Tras resolverse la autorización, `retryHeld` sólo libera el intento: el envío reutiliza exactamente el original y el ACK debe conservar la autorización original con recovery_id/admission_* auditados. Incluso con admisión cerrada, un evento ya APPLIED recupera su ACK histórico por la ruta base autenticada.

## Pruebas y límites

Las pruebas locales usan SQLite real y verifican commit conjunto, rollback en cada escritura, cierre/reapertura, contexto durable, ACK ausente/manipulado, admisión diferente sin recuperación, HOLD/backoff, replay histórico sin backfill y opt-in sólo en negociación.

Las suites ERP opt-in necesitan **una fixture nueva distinta para cada orden**: HTTP loopback con auth/rutas/productor/RPC originales del commit2251 y PostgreSQL17 privado por socket. Mutan sólo fixtures sintéticas y se omiten explícitamente sin variable de entorno:

```bash
npm run test:article-formats:network
# Primera fixture nueva:
CLIC_FORMATS_LOCAL_FIXTURE=/ruta/fixture.json npm run test:article-formats:erp-local
# Otra fixture nueva; nunca reutilizar la ya consumida:
CLIC_FORMATS_LOCAL_FIXTURE=/ruta/otra-fixture.json npm run test:article-formats:return-context:erp-local
```

Los casos reales prueban RESTOCK negociado → commit local → cambio DAMAGED/NO_RETURN → conflicto sin efectos ERP nuevos; Outbox local y stock pendiente intactos; restaurar RESTOCK sin aprobación no basta; recuperación explícita sintética, pérdida de ACK/replay tras flagoff; RETURN y VOID según las tres políticas, stock y COGS. No equivalen a operación APK completa ni a despliegue.

La activación sigue cerrada (`ARTICLE_FORMATS_READINESS` todo false). La corrección del vínculo ERP no abre readiness ni resuelve por sí sola las validaciones operativas nativas, UI, inventario suplementario y rendimiento. No hay merge automático, SQL remoto, cambios en el repositorio ERP, grants/capabilities/flags reales ni construcción/instalación APK en esta entrega.
