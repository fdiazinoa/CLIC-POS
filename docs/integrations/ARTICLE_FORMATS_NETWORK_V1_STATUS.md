# Formatos comerciales: contrato ERP v1, activación cerrada

Fuente POS: origin/main 29bb3236 (incluye PR #890); rama feature/pos-article-formats-network-v1. Se conserva además el fix de devoluciones rápidas/grilla/variantes del PR #891, sin mezclar develop.

Fuente ERP consultada, sin modificar su repositorio: [PR #2250](https://github.com/fdiazinoa/CLIC-ERP/pull/2250), commit `4c456440bd9b3b87455747dad254f1e3a51bd8d1`, `docs/ARTICLE_FORMATS_POS_NETWORK_V1.md`. Consultar código no demuestra SQL aplicado en Supabase ni endpoints desplegados. Las pruebas utilizan exclusivamente sus rutas/productor/RPC originales en un servidor HTTP loopback con PostgreSQL17 privado y fixtures sintéticos.

## Adaptadores preparados

- `wire.ts`: negociación exacta, headers actuales, DTO sin renombres, envelopes SALE/RETURN/VOID, cantidades/importes strings con escalas 4/6/2, factor number, transporte con timeout y sin redirects, hash compatible con `jsonb::text` y validación completa del ACK.
- `networkMaster.ts`: sesiones V3 contrato3, manifiesto, seis datasets, hash del texto HTTP original, cursores por sesión, ACK posteriores al commit local, vacíos explícitos, políticas/precios históricos. El puntero activo cambia en una transacción después del recibo completo ERP; el staging no aparece en ventas.
- `master.ts`/`cart.ts`/POSInterface: ERP_ID ↔ SKU explícito, sin asumir igualdad ni inventar variante. Se conserva el snapshot ERP en el evento y SKU únicamente para el consumidor POS.
- `posting.ts`: venta/líneas, pagos, series y contador, stock base, Kardex, diario preparado y Outbox exacto se guardan en un solo executeSet nativo. IDs/content originales sobreviven reintentos. Devoluciones usan venta aceptada y líneas originales, políticas/tarifa/costo/impuestos/descuentos históricos, capacidad y remanentes centesimales; VOID exige toda la venta sin devoluciones previas.
- `runtime.ts` y puerto de SyncManager: el ingreso operativo exige readiness integral. `ARTICLE_FORMATS_READINESS` permanece todo false; no se habilitaron flags, capabilities ni grants reales. Los adaptadores pueden construirse expresamente para validar el contrato en el laboratorio local, sin cambiar readiness.
- El ACK validado se persiste junto al estado Outbox y documento en otra transacción. Timeout/HTTP200 incompleto no confirma. Cierre de admisión conserva pendientes; recuperación de un ACK ya aplicado no exige una negociación nueva que el ERP ahora pueda rechazar.

## Límite de escritores legacy

Las escrituras propias de Capacitor se serializan incluyendo su lectura y planificación. Los cálculos legacy que leen fuera de ese puerto podrían llegar después con un snapshot viejo. Por ello SQLite protege las colecciones de contabilización/secuencias/stock con triggers: después del primer asiento wire sólo el puerto de contabilización/ACK, con permiso transitorio dentro de esa misma transacción, puede modificarlas. Un escritor legacy obsoleto recibe `POS_FORMAT_LEGACY_WRITER_FORBIDDEN`; no sobrescribe stock ni retrocede secuencias. Rollback/commit dejan vacío ese permiso.

Esto es una barrera de seguridad del perfil cerrado, **no una afirmación de coexistencia de contabilización legacy y formatos en el mismo almacenamiento**. La operación actual sigue por legacy mientras formatos permanecen cerrados y no se ha contabilizado wire. Antes de cualquier futura activación se debe completar/validar la propiedad de escritores, inventario suplementario V3 y flujo UI de este perfil; no levantar el fence para permitir escrituras parciales. No se cambió el flujo de cobro operativo para abrirlo.

LEGACY_B requiere un bloque local vigente, de tipo y número exactos, con propietario terminal explícito; consume su número en el mismo commit. Un buffer legacy sin propietario no se interpreta como autorización ERP y se rechaza. No se solicita ni reserva remotamente un NCF dentro de un commit local. ECF, crédito, multimoneda, cierre Z, lotes/series/recetas y otros perfiles excluidos no se degradan a esta vía.

## Bloqueo real: política física de devolución

Reproducción contra ERP original/PostgreSQL17:

1. Negociación RESTOCK, grant_revision=1.
2. SALE2Caja24: 137 → 89 BASE.
3. POS prepara RETURN0.5Caja24 con 12 BASE a restituir.
4. Grant cambia a DAMAGED antes del primer POST.
5. ERP admite el evento, mantiene 89 BASE y devuelve ACK positivo sin política/revisión aplicada. Replay devuelve ese mismo ACK.

Un POS que ya confirmó RESTOCK tendría 101 BASE. El wire v1 no vincula la autorización física usada al commit local y su ACK no permite distinguir/reconciliar ese efecto. Renegociar justo antes del POST no elimina el lapso de carrera. El RPC bloquea el grant durante admisión, pero ese lock no liga negociación y commit local anterior. **No se puede declarar integración integral ni abrir readiness con este contrato.** No se añadieron campos wire inventados ni se modificó ERP para ocultar el problema.

El [prompt ERP](ARTICLE_FORMATS_ERP_POLICY_BINDING_PROMPT.txt) pide un vínculo verificable de autorización histórica, validación antes de efectos, ACK con contexto/política aplicada y recuperación idempotente. SQL remoto, grants/flags reales y despliegue requieren otra autorización.

## Pruebas y alcance de la evidencia

```bash
npm ci
npm run test:article-formats
npm run test:article-formats:network
npm run harness:test
npm run build
# Sólo fixture local nueva con ERP original + PG privado; esta suite cambia la fixture:
CLIC_FORMATS_LOCAL_FIXTURE=/ruta/fixture-sintetica.json npm run test:article-formats:erp-local
```

Las suites locales de SQLite prueban fallos antes de cada escritura y antes/después del commit, rollback completo, reapertura de archivo, stock, pagos, series, diario, Outbox, snapshots, centavos, ACK incompleto y rechazo de escritores legacy obsoletos. Las pruebas del adaptador de maestros con transporte controlado son pruebas unitarias; no demuestran integración ERP.

`articleFormatsERPIntegration.test.ts` es opt-in y exige URL loopback, socket PostgreSQL privado y base sintética. Utiliza HTTP/auth/rutas/RPC/productor originales ERP y SQLite en archivo: seis datasets/vacíos y recibos, 137→89, 24→12 mientras la venta24 sigue pendiente, offline/reapertura, timeout/ACK perdido, cierre/reapertura de admisión, contenido conflictivo, pack6/VOID/RETURNmediaCaja24, conciliación 101 BASE y hash real PostgreSQL. Sin fixture se marca SKIP, nunca se presenta como integración aprobada. Cada ejecución requiere fixture nueva; sus mutaciones no deben dirigirse a ningún entorno real.

La evidencia independiente del harness distingue checks locales, gate integral bloqueado por ERP, y cualquier validación nativa/rendimiento pendiente. No se construyó ni instaló APK; no hubo merge, despliegue, SQL remoto ni activación de empresas/terminales.
