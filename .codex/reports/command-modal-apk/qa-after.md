# QA Android post actualización — command-modal-flow

## Resumen

**PASS WITH OBSERVATION** en el emulador autorizado `127.0.0.1:6555` (Pixel C, Android 11/API 30). Está instalada `com.clicpos.app` **1.1.407** (`versionCode 1407`). El SHA-256 del `base.apk` instalado es `8d2b2d55aadb9eee6013637a9d52701b96afb204f08d424f5ce79337e419f9e5`, idéntico al candidato comunicado para el commit fuente `00b6871`.

La observación pendiente es un cambio en el hash del documento de configuración. La identidad operativa y los conteos permanecen, pero el baseline no conservó una copia estructural sanitizada que permita atribuir el campo exacto modificado. No se declara igualdad byte a byte de la configuración.

## Bug que soluciona

El APK incorpora el rediseño del flujo de modificadores. En el producto real `Hamburguesa BBQ - Regular`, el modal instalado permite recorrer Extras → Bebida → Nota con resumen de precio fijo y diseño responsive.

## Funcionalidades comprobadas

- Apertura del modal desde el catálogo real, sin modificar el badge existente `SIN STOCK`.
- Bacon `+RD$60` y Extra queso `+RD$30`: base RD$550, extras RD$90, total RD$640.
- Avance manual a Bebida; selección de Agua con Gas; autoavance a Nota.
- Cierre con la X desde Nota, sin pulsar **Agregar al pedido**.
- Modal visible y utilizable en landscape (`1280×820` CSS px, DPR 2) y portrait (`900×1200`, DPR 2).
- La orientación del sistema se restauró a su configuración previa: rotación automática activa y `user_rotation=0`.

## Comparación de persistencia

| Invariante | Antes 1.1.405 | Después 1.1.407 | Resultado |
|---|---:|---:|---|
| Terminal | CAJA 4 / UUID `69dc…d298` | Igual | PASS |
| Código / modo | POS-003 / SERVER_ERP | Igual | PASS |
| Productos | 165 | 165 | PASS |
| Transacciones | 0 | 0 | PASS |
| Tickets parqueados | 2 | 2 | PASS |
| Documentos config | 1 | 1 | PASS |
| SHA-256 config | `a2239e77…b2e` | `11709b9a…a44` | CAMBIO OBSERVADO |

Las claves de identidad principales conservan el UUID. `clic_erp_sync_local_terminal_id` contiene ahora `POS-003`; se registra como normalización observada, sin inferir pérdida de identidad. El documento config conserva sus secciones principales, incluyendo `businessConfig`, `operational`, `terminals`, `taxes`, `paymentMethods`, `receiptConfig`, `features`, `ux` e `integrations`, pero no se inspeccionaron valores sensibles.

## Estabilidad y logs

PID `24407` antes y después de 16 segundos; `MainActivity` permaneció activa. El log acotado por PID no contiene coincidencias de crash, ANR, `ERR_CLEARTEXT_NOT_PERMITTED`, `Failed to fetch` o excepción no controlada. Log sanitizado: `/tmp/command-modal-apk-logcat-sanitized.log`, sin secretos.

## Evidencia visual

- Principal landscape: `/tmp/command-modal-apk-after-extras-landscape.png` — SHA-256 `2ce936040535bc1477f119dcf069892feb298d6f4d462b4e8baa4bfe935866b2`.
- Nota landscape: `/tmp/command-modal-apk-after-note-landscape.png` — SHA-256 `3b3cfb46de63341500a22d8d8131aa445a225bd4dd374629d75ddfbb0b54d570`.
- Cancelado landscape: `/tmp/command-modal-apk-after-cancelled-landscape.png` — SHA-256 `5c100dff293b42cf61a7739462b520d2c43bf59fe1ee8891933a5ac78b553436`.
- Principal portrait: `/tmp/command-modal-apk-after-extras-portrait.png` — SHA-256 `789691d8736e3fbde81e93fa4b6a0dce42174cc938895e66c603ec13b2db0846`.
- Nota portrait: `/tmp/command-modal-apk-after-note-portrait.png` — SHA-256 `84f6d6cbe6fda765615b57fb1f8be191472777328bbd6bf96bb892f04bcb4343`.
- Cancelado portrait: `/tmp/command-modal-apk-after-cancelled-portrait.png` — SHA-256 `2a8b4697d2be8ebbc0f2da071a2477952fb35d5d03c5632d664a295fed0e866b`.

## Checklist QA

- Build web / Gradle / firma: verificados por las puertas independientes previas; no repetidos por QA.
- Instalación ADB conservadora: evidencia en `/tmp/command-modal-apk-install.log`; QA verificó bytes y versión instalados.
- Versión instalada: PASS, 1.1.407/1407.
- Identidad y conteos: PASS.
- Smoke funcional del modal: PASS.
- Venta/pago/configuración/stock/sync manual: no ejecutados.
- Estabilidad y logs: PASS.
- Configuración byte a byte: **no atestiguada**, por cambio de hash observado.
- Cliente/Master: pendientes.
- Puerta de promoción: pendiente; este resultado no autoriza producción.
