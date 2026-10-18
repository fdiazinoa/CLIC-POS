# Fuente del candidato APK con consulta de estado y sin panel de pruebas

Base actualizada: `origin/develop` `eeee6a01c733b56f15af9c2597047be21a8be828`.
Rama: `fix/android-status-no-test-panel`. Desarrollo en worktree aislada `/tmp/clic-pos-status-apk` para preservar otros checkouts; la worktree firmada sigue sin modificaciones.

Se integran mediante merges sin squash los sources `78b0af0a0ae46a53752891cde70561c248a8a73a` (último APK candidato 1.1.532/code1532) y `aa2a3e0e12927453168b2f1ed7c129c9baebd8cf` (consulta exclusiva del e-CF original). Ambos, además de develop actualizado, deben ser ancestros del candidato. Los merges automáticos de App/metadata se revisaron conservando el guard tax/service contra claim/ISSUE y la reconciliación de rechazo `ERROR` del original e historial.

## Cambio autorizado

- Se elimina `components/FiscalPreparationPanel.tsx`, su import/render y prop de Settings.
- Se desconecta de producción el import/factory del controlador, su memo/cleanup y el wrapper financiero. App llama directamente al mecanismo existente `persistV3FinancialTransaction`.
- Se conservan los módulos aislados de preparación para sus pruebas, junto con `Caja6FiscalPreparationPolicy`: la identidad exportada sigue siendo consumida por la autenticación. Ningún módulo productivo monta el controlador de preparación ni se empaquetan sus textos.
- La retirada revierte intencionadamente la entrada UI/prospectiva añadida en `27cee169`/`38b2fa13`; no se presenta como equivalencia de parche. El resto de los hotfixes del APK anterior se conserva por ancestralidad y comparación de fuentes.
- Permanecen sin cambios frente a `78b0af0a` los contratos receipt/dispatch tax/service, auth/sesión Caja6 y el consumidor opcional bindingEvidence. No se activa bindingEvidence ni se modifica configuración ERP, fechas históricas, identidad, importes, datos operativos o terminales Pancuvi/Mykonos.

## Pruebas y límites

La regresión de ausencia del panel/controlador se ejecutó antes de retirar la UI y falló; el control de conservación de auth/guards pasó. Se ajustan las comprobaciones de composición productiva y el harness de recuperación de reservas para ejercitar el callback real App con persistencia financiera directa sobre SQLite, conservando escenarios de commit ambiguo/publicación/remount/idempotencia y los tests puros de seguridad del controlador.

La primera suite amplia completó 775 de 776 casos: el fallo restante era una aserción heredada `versionCode 1531` que ya discrepaba con el source 1.1.532. Un anexo prospectivo independiente autorizó sustituir solamente ese literal por parseo de entero seguro >=1532, manteniendo los asserts de auth/emisión y verificando rechazo de valor ausente, inválido, decimal o inferior. No se cambió Gradle ni la versión. El fallo original se conserva en el log y la suite se repite sobre el nuevo candidato.

La evidencia técnica exacta (Node22, npm ci, suites fiscales/auth/binding/tax/session/reservas, diez contratos operacionales de la skill, lint/build, selector transversal, prebuild y hashes/assets) se registra externamente con el prefijo `/tmp/clic-tck33-pos-developer*`, ligada al SHA congelado. Los tests son fixtures/simulaciones y adaptadores SQLite reales, sin llamadas ERP/ISSUE de producción. No sustituyen QA física ni revisión independiente.

Este commit no incrementa versión ni ejecuta Gradle, genera/instala APK o modifica la worktree firmada. Conserva en fuente la versión heredada 1.1.532/code1532. La generación solicitada depende de la corrección separada y verificada de TCK6000033 en ERP y de los gates aplicables. El siguiente número deberá resolverse monotónicamente justo antes de la única compilación final.

Review/QA/sync/performance independientes sobre el nuevo SHA permanecen pendientes; device/ERP real, topologías, upgrade, firma del nuevo artefacto y promote no se infieren de tests. La selección nativa de roles y UUID separado de sesión no están expuestos por este cliente: se usan agentes delegados con identidad canónica real, sin inventar firmas. El desarrollador entrega solamente `IMPLEMENTATION COMPLETED`, sin aprobación propia ni autorización de release.
