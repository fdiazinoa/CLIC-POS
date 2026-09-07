# Recuperación tras pérdida de base: disponibilidad y continuidad

Implementación POS sobre PR #582; contrato ERP estable: `14d903aa8414993252c1717822c17d2df74dde59`, PR CLIC-ERP #2026 hacia clean-erp.

## Comportamiento

El arranque y la sincronización consultan capabilities autenticadas sin depender de la bandera local de pruebas. La autorización se conserva por contexto para uso offline; un cambio de terminal no hereda esa autorización. Una desactivación explícita del ERP la elimina. La restauración sigue siendo una acción explícita del usuario.

Después de restaurar, POS persiste una intención técnica antes de solicitar POST originals/retained-epochs. Reutiliza requestId, época nueva y openSetId en reintentos. GET por requestId permite resolver un ACK perdido. Solo después del ACK validado y una lectura fresca del linaje ERP se publican atómicamente los contadores técnicos nuevos. Una intención pendiente impide capturar nuevas operaciones hasta resolverla. No se asignan números fiscales ni se reenvían operaciones recuperadas.

Los respaldos posteriores conservan referencias originales de los documentos restaurados. Las recepciones se drenan en orden de secuencia para respetar el control ERP; una base vacía no publica un manifiesto vacío que sustituya el remoto. La repetición de una importación comprueba las filas ya restauradas aun cuando cambie el snapshot o el linaje. Las operaciones sin checkpoint posterior bloquean la recuperación del conjunto.

## Evidencia reproducible

- `tests/recoveryAvailability.test.ts`: descubrimiento con preferencias vacías, caché offline, revocación y aislamiento.
- `tests/recoveryRetainedEpoch.test.ts`: intención durable, validación del ACK, bloqueo pendiente, atomicidad y contadores sin retroceso.
- `tests/recoveryEpochIntegration.test.ts`: SQLite y PostgreSQL aislados, usando servicios y migraciones ERP reales del commit indicado. Pérdida de BD, restauración, ACK perdido, reinicio, venta nueva y segundo respaldo/restauración. Repetición sin duplicados; cero eventos comerciales y cero cierres nuevos en ERP.

Para la prueba conjunta se requieren las dependencias POS instaladas, checkout ERP indicado y embedded-postgres instalado. Ejecutar desde POS:

```sh
CLIC_ERP_REVIEW_PATH=/ruta/al/CLIC-ERP \
CLIC_EMBEDDED_POSTGRES_MODULE=/ruta/node_modules/embedded-postgres/dist/index.js \
node --import tsx --test tests/recoveryEpochIntegration.test.ts
```

Sin ambas variables la prueba conjunta se omite; un resultado omitido no demuestra integración. En esta entrega se ejecutó, sin omisiones. Suite ampliada: 115 pruebas aprobadas, cero fallos/omisiones; build Vite aprobado y git diff --check limpio. Incluye arranque con padrón vacío, autorizaciones, sincronización y oráculo Z existente.

## Estado de entrega y límites

Código y pruebas aisladas completados. Esta entrega todavía no está instalada: emulador sigue en APK 1.1.304 (1304), que incluye PR #580. ERP #2026 requiere integración y migración antes de probar continuidad real. El siguiente APK debe conservar #580 y estas modificaciones; validar descubrimiento sin bandera manual y un nuevo respaldo tras recuperar en la misma terminal demo.

No se cambió pairing/takeover ni cálculo de cierre. La evidencia previa de borrado real y restauración de dos tickets corresponde al APK 1.1.304, con habilitación manual; no demuestra esta automatización nueva. Las pruebas aisladas no demuestran despliegue, disponibilidad remota ni recuperación de operaciones que nunca salieron del dispositivo. Legacy UNKNOWN, exactZEligible=false, closeAuthorization=NOT_GRANTED.
