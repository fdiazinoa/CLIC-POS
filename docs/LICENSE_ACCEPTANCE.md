# Lectura, PDF y aceptación local

`VITE_LICENSE_ACCEPTANCE_ENABLED` vale `false` por defecto. Habilitarlo requiere revisión legal y aprobación de publicación. No modifica el arranque de cajas ya configuradas ni la operación offline.

Al terminar el login o el cambio de contraseña, antes de guardar la identidad del cliente y completar la activación, el cliente lee las 13 secciones, puede descargar el PDF genérico y confirma la casilla. No se registra por leer o descargar. La fecha es el instante de aceptación UTC del dispositivo, no fecha de publicación ni hora certificada del servidor.

La evidencia reside en localStorage `clic_license_acceptance:<tenant codificado>:<versión codificada>`, con cliente, nombre disponible, usuario, versión, hash SHA-256 del documento y fecha UTC del dispositivo. Se escribe y se relee antes de continuar; fallos bloquean y permiten reintentar. Una aceptación válida para ese cliente/versión/texto se reutiliza en ese dispositivo. No contiene tokens ni contraseñas. El nombre usa metadatos disponibles de razón social/empresa y, si faltan, slug o identificador resuelto; no inventa una razón social.

Es un registro local modificable; no es auditoría central ni evidencia a prueba de manipulación y no deduplica entre dispositivos. No se añade API, migración, IP ni atribución certificada de usuario. El PDF es únicamente el documento, no un recibo personalizado o firmado.

Texto canónico: `legal/licenseClause.ts`. Para modificarlo, publicar una versión nueva y actualizar el hash del JSON literal; generar el PDF con `python3 scripts/generate_license_pdf.py` (ReportLab es herramienta de desarrollo, no dependencia runtime). Verificar extracción y renderizado del PDF. Pruebas: `npx tsx --test tests/licenseAcceptance.test.ts`.

Alcance en develop: el paso se aplica al flujo de activación Cloud con cliente identificado. El selector existente «Elegir tipo de POS» continúa hacia el asistente local/ERP sin cliente identificado y no registra una aceptación ficticia. Esta entrega no añade aceptación al asistente ni promete exigirla en todos los modos de instalación.
