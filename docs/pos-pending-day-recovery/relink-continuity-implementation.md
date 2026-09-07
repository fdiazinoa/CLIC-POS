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

## Validación real del APK 1.1.305

Fuente develop 05ce221, APK1305 instalado mediante actualización en 127.0.0.1:6555. ERP #2026 efectivo y migración autorizada 20260907215647. Se retiraron únicamente la bandera local de prueba y caché de descubrimiento antes de instalar. Al arrancar: descubrimiento automático exitoso, cuatro usuarios conservados, CAS automático ACKNOWLEDGED (requestId 11a31892-9334-44f0-996b-4627ec257adc, generation1).

El método real updateRetainedBackup del APK publicó MEMBERSHIP recibo22 en época4676bc51-f84d-45b1-89da-5fe99c4ec08d, secuencia1, conservando referencias18/20 de los dos tickets recuperados. Repetir respaldo y descarga conservó recibo22. Se compararon ambos tickets e historial íntegros, series internas, series documentales, asignaciones y rangos fiscales con la BD previa: iguales. ERP confirmó petición durable, 22 originales, cero eventos comerciales posteriores a la migración y cero cierres recuperados.

Se intentó restaurar el manifiesto nuevo sobre las mismas filas ya existentes: rechazado con RECOVERY_LOCAL_CONFLICT, sin modificación. Esto prueba protección contra sobrescritura, no una restauración repetida exitosa de ese manifiesto. No se borró nuevamente la BD en esta ejecución. Venta nueva posterior a recuperación y nueva restauración vacía en APK305 todavía pendientes de prueba demo. La prueba conjunta aislada sí cubre ese recorrido; ambas evidencias se mantienen separadas.
