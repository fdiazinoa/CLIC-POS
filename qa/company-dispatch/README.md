# Laboratorio local de despacho ordinario

Desde esta worktree POS, con la worktree hermana `CLIC-ERP-company-dispatch` y el PostgreSQL **local y desechable** autorizado en 55443:

```sh
PATH=/Users/felixdiaz/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin:$PATH \
CLIC_DISPATCH_TEST_PG_PORT=55443 node --import tsx qa/company-dispatch/local.mts
```

El proceso imprime su URL loopback. Crea su propia base PostgreSQL y un directorio temporal con SQLite y witness; `Ctrl-C` limpia esos recursos. No lee `.env` ni instala/aplica nada remotamente. No usar otro puerto, servidores externos ni dispositivos operativos.

1. Con el panel del laboratorio cerrado, seleccionar **Artículo sintético → COBRAR → RD$50 → FINALIZAR VENTA**.
2. Comprobar **Venta exitosa** y pulsar **Nueva Venta**.
3. Abrir **Laboratorio: estado y despacho ERP → Enviar outbox al ERP**. La factura debe reservar una unidad, conservar el físico y mostrar el SALE como `APPLIED_ERP`.
4. En la reserva: **Generar conduce de reserva → Confirmar ubicación/tramo → A · Pasillo A → A/01 → Agregar reparto → Confirmar reparto**. El físico baja una unidad y aparece un solo efecto.

Se montan POSInterface y PaymentModal reales. Se ejecutan los callbacks productivos POS y App, el constructor y writer financiero NativeSQLite, sender/outbox, normalizador/envelope ERP, adopción SQL y panel/selector/confirmación de conduce. Empresa, política, terminal futuro, barrera y entrega de cuota se producen mediante el código real; no se siembran esas autoridades.

**Límites explícitos:** autenticación, permisos, maestros, serie interna, plataforma Android y transporte bound son puertos sintéticos. El witness externo usa archivos del directorio temporal, no Preferences Android. No acredita Android/Capacitor real, proveedor, impresión, montaje autenticado Express/Vercel ni App bootstrap completo. El estado React y la persistencia local del carrito pertenecen al wrapper de laboratorio.

`PAYMENT_POSTED` usa `applySyncInboxEventById` vigente. El estado muestra recibos, asientos y líneas reales para comprobar que el crédito cancela la misma cuenta por cobrar de la venta. `replayPayments` vuelve a ejecutar el mismo inbox ya aplicado y verifica que ningún efecto cambió. Esto no prueba atomicidad frente a una caída intermedia del writer legacy ni certifica funcionalidad completa. El perfil predeterminado es no fiscal; los artículos con formatos/tracking/recetas siguen fuera de este smoke ordinario.

Para repetir exclusivamente la aplicación ya completada, sin un segundo cobro:

```sh
curl -sS http://127.0.0.1:PUERTO/lab/call -H 'Content-Type: application/json' \
  -d '{"name":"replayPayments","args":[]}'
```

Debe devolver `unchanged:true`. El comando `flush` posterior debe devolver `sent:0`; el cupo consumido, los recibos, asientos y físico no cambian. La prueba sólo considera un inbox ya `APPLIED`; no se afirma recuperación de una caída entre las requests contables legacy.

## Perfil fiscal offline existente

Añadir `--fiscal` al mismo comando. El perfil instala la migración local por sucursal y utiliza el servicio ERP real de autorización `OFFLINE_FISCAL_ALLOCATION_V2`, el cliente fiscal nativo y la preparación conjunta de número y cupo. La autorización no se siembra. Los maestros, contexto de autenticación y credenciales son sintéticos y sólo pertenecen a la base efímera.

La misma venta UI genera su NCF y los eventos originales SALE/PAYMENT. Tras enviar outbox, ambos deben quedar `APPLIED_ERP`; el físico permanece igual hasta el conduce. Para ejercitar el worker fiscal vigente, exclusivamente en esta URL loopback:

```sh
curl -sS http://127.0.0.1:PUERTO/lab/call -H 'Content-Type: application/json' \
  -d '{"name":"fiscalWorker","args":[]}'
```

El proveedor es un stub explícito que responde pendiente sin firma DGII. Se espera un fence persistido, `providerIssues:1` y estado `OUTCOME_UNKNOWN` sin error; no significa aceptación fiscal. Repetir no autoriza otro ISSUE. El selector y la confirmación de conduce son los mismos del perfil ordinario.

El puente HTTP conserva el argumento opcional `undefined` y las mutaciones del objeto checkout de los métodos fiscales reales. El adaptador SQL ejecuta también el join de binding solicitado por el lector de adopción. No sustituye resultados ni autoriza rutas operativas externas. Este perfil no acredita el transporte de autenticación real ni el plugin Android.
