# Absolute: auditoría del flujo fiscal E34 — 12 de noviembre de 2026

Resultado: diagnóstico del fallback confirmado; el flujo fiscal completo sigue BLOQUEADO. Corregir el nacimiento en POS por sí solo no demuestra que ERP pueda emitir RETURN. El PR de consecutivos no se presenta como reparación del envío fiscal.

## Evidencia operativa (consultas SELECT, sin mutaciones)

En Absolute / Master-01, las fuentes SALES_CREDIT_NOTE_POSTED de NCS001000003 / E340000000003 y NCS001000006 / E340000000006 están APPLIED. Referencian respectivamente E320000000002 y E320000000003. En ambas son nulos fiscalEnvironment, fiscalWorkflowCheckoutId y fiscalWorkflowBirth. No hay filas en erp_pos_fiscal_workflows_v2 para esos dos E34 dentro del mismo tenant/empresa/terminal.

También se leyó la definición de las funciones instaladas: erp_pos_fiscal_allocation_return_intake_v2 existe, pero erp_pos_fiscal_allocation_claim_v2 mantiene el guard `w.operation_kind<>'SALE'`, que impide autorizar el despacho de RETURN. La existencia del intake RETURN no demuestra un emisor RETURN completo.

No se consultó directamente MSeller. La ausencia de workflow/respuesta en ERP NO prueba que MSeller nunca haya recibido esos NCF. No se generó otra NC, no se modificaron números y no se fabricó un nacimiento retroactivo.

## POS: fuente de 635 y estado actual

Se leyó RefundFiscalReservation.ts en cd379b37 (referencia aportada para 635) y en la base develop f162d73f. En la fuente original, cualquier error del checkout o un checkout sin allocation termina en reserveFiscalNumber, que devuelve NCF/fiscalIssuance sin nacimiento.

- services/fiscal/RefundFiscalReservation.ts:46 (rama de este PR): incluso con la mejora de idempotencia, no disponer de allocation todavía permite reservar por la ruta antigua. Evitar otro consecutivo no soluciona esta falta de workflow.
- App.tsx:13284: cuando SÍ hay checkout, ya conserva checkoutId, authorizationId y el ambiente de la allocation. Sin checkout, esos campos faltan. No debe inventarse un ambiente ni añadirse un UUID para reemplazar una autoridad fiscal.
- services/sync/LargeMasterSyncV3FinancialCommit.ts:311: fiscalWorkflowBirth se genera en el SOBRE del evento, condicionado a fiscalWorkflowCheckoutId y una allocation válida. No es necesario inventar ese campo dentro de la transacción de App. El evento sin checkout actualmente puede persistirse sin birth.
- App.tsx:11366: MSeller retorna por consult-only; consulta workflow si hay checkout y consulta el envío original en otro caso. No se debe añadir ISSUE después de ese retorno.
- services/fiscal/FiscalStatusReconciler.ts:42: sin scope original inequívoco conserva el pendiente. Firma disponible y aceptación fiscal son estados distintos; APPLIED comercial no equivale a ninguno de ellos.

No se verificó el contenido del binario instalado. La versión 1.1.635 sigue siendo la reportada para el caso.

## ERP: bloqueos adicionales reproducidos en fuente clean-erp c11d9626

- server/services/posEventApplier.js:4492: solo un birth de allocation v3 invoca el intake RETURN. La devolución comercial mantiene su receptor propio.
- server/services/fiscal/posFiscalWorkflowV2Source.js:54: el perfil ordinario admite E31/E32/E44/E45, excluyendo E34. Reproducción sin HTTP: un control E32 válido pasa; convertido a E34 obtiene FISCAL_WORKFLOW_DOCUMENT_UNSUPPORTED.
- server/services/fiscal/posFiscalWorkflowV2Materialization.js:24: busca SALE_POSTED. Un snapshot cuyo único evento es SALES_CREDIT_NOTE_POSTED obtiene FISCAL_WORKFLOW_MATERIALIZATION_AMBIGUOUS.
- supabase/migrations/20261023200504_pos_fiscal_allocation_authority_v2.sql:153: el guard del claim admite SALE; la misma restricción se confirmó en la función instalada mediante pg_get_functiondef.
- supabase/migrations/20261025120000_pos_fiscal_allocation_return_intake_v2.sql:1: su alcance declarado es propiedad del número/evidencia original. No completa materialización, contabilidad ni despacho RETURN.

No se modificó ni desplegó código/migración del ERP durante esta revisión.

## Validación y siguiente implementación necesaria

73/73 pruebas ERP existentes pasan (posFiscalWorkflowV2Source, posFiscalWorkflowV2Worker y posFiscalOfflineAllocationV2). No son una prueba E34 completa. En POS, la ampliación fiscalWorkflowProducer ejecutada junto con las suites de la corrección arroja tres fallos: el fixture del productor de VENTA no inyecta resolveCommittedFiscalReceipt. No se cambió ese fixture ni se debilitaron sus pruebas; el resultado no se declara verde ni se atribuye al cambio de NC.

Antes de dar por resuelta E34: el POS debe conservar un pendiente durable cuando no tenga una autoridad RETURN soportada; ERP debe implementar/verificar materialización y autorización de envío RETURN con la referencia exacta y la foto original; el emisor del workflow debe conservar su fence de envío único. Ampliar solamente una lista de códigos o quitar el guard SALE no constituye una solución válida.

Las pruebas pendientes de extremo a extremo son: reserva denegada, offline/reconexión, reinicio, doble clic, duplicado de evento y pérdida de respuesta, con una sola aplicación comercial y un solo envío fiscal. Deben distinguir recibido, firmado y aceptado. Las NC 3 y 6 requieren primero búsqueda inequívoca en MSeller por emisor/ambiente/e-NCF, sin reenvío a ciegas.
