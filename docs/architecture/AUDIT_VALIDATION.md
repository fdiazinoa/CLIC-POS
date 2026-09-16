# Evidencia de instalación del procedimiento

Fecha 2026-09-16. Base congelada `a186a8c33cabf8700c28dba85deaabfe76b03f81` de origin/develop. Rama `feature/process-multiagent`. Worktree `/private/tmp/clic-pos-multiagent-procedure` por conflictos/cambios ajenos en principal, preservados sin resolver ni copiar. Autor implementación: sesión coordinadora `/root`. Revisión independiente: `/root/audit_review`; QA independiente: `/root/procedure_qa`. Esta instalación fue autorizada en la solicitud; no se presenta como una ejecución previa de un workflow que todavía no existía.

## Alcance inspeccionado

1023 archivos versionados enumerados; 813 fuentes escaneadas con inventario de rutas, líneas e imports. Lectura profunda de entry points, App/POS/Payment/Table, DB factory/adaptadores, transacción/flags/Outbox/sync, APIs local/ERP, auth/setup, bridges Java/Kotlin, Gradle, scripts/CI, constitution/baseline y diagnósticos. No se afirma auditoría semántica de cada línea ni validación runtime del sistema entero.

## Validación técnica

Entorno local Node v24.11.1 / npm 11.6.2; CI declara Node 22. La diferencia se registra, sin atribuir la ejecución local a Node 22.

| Comando/check | Resultado observado |
|---|---|
| npm ci --no-audit --no-fund | PASS, dependencias instaladas con lockfile |
| npm run build | PASS: typecheck tsc -b y Vite; warning chunks >700 kB, catálogo ~1.166 MB minificado |
| npm run lint | BLOCKED: ESLint 9.39.2 no encuentra eslint.config.(js/mjs/cjs), fallo preexistente de base |
| tsx --test siete suites seleccionadas | 46/46 PASS: apkReleaseGate, durableOutboxV2, durableOutboxBatchSender, operationalAcknowledgement, tableMove, paymentFractions, syncMetrics |
| npm run test:catalog-sync | PASS: 89 tests y 18 de integración automatic saves |
| node --test services/sync/PrivateRealtimeAuthorization.test.mjs | BLOCKED/fallo: importa vitest no declarado ni instalado; no hay runner corroborado |
| node --check .codex/scripts/workflow-gate.mjs | PASS |
| node --test .codex/scripts/workflow-gate.test.mjs | 9/9 PASS; incluye rechazo de FAIL/BLOCKED/N/A, autoaprobación, SHA obsoleto, artefactos ausentes y destino de salida dentro repo |
| QA independiente de archivos/contratos | 18 archivos solicitados presentes; seis TOML parsean con tomllib; plantilla JSON válida con nueve gates; enlaces locales verificados; 45 tests de selector crítico existen |
| git diff --check | PASS |

Los logs locales están en `/private/tmp/clic-pos-multiagent-{install,build,lint,tests,catalog,realtime,independent-qa}.log`; no son evidencia persistente de un release. Las conclusiones y resultados aquí quedan versionados; revisión/QA final ligada a commits se conserva en el PR.

## Revisión independiente y correcciones

El reviewer encontró import espurio tomado de comentario en inventario, nomenclatura de ramas heredada contradictoria, salida --out que podía sobrescribir código y comando MJS mal caracterizado. Se corrigieron extractor/rama, guard de salida con resolución de symlinks y descripción del bloqueo Vitest. Se añadieron pruebas de protección del destino, incluido enlace simbólico colgante identificado en segunda revisión. Ningún archivo funcional POS se modificó para corregirlos.

## Gates no ejecutados y límites

No se generó/instaló/promovió APK; no se usó la worktree de firma ni keystore; no hubo E2E hardware, provider de tarjeta, ERP real o baseline nueva de latencia. El smoke de tooling no certifica venta/cobro/mesas/Z/print/offline en producción. La carga nativa de roles TOML depende de cliente/proyecto confiable y no se certificó en esta sesión; roles de revisión/QA se delegaron mediante message explícito.

Lint y suite Vitest impiden declarar todos los checks POS verdes. Esta tarea documental puede quedar instalada y propuesta en PR con esos bloqueos declarados; release funcional permanece bloqueado hasta solventar los checks/entornos pertinentes. No se cambió CI APK existente ni protección remota de ramas; el gate nuevo es enforcement local obligatorio por instrucciones, no intercepta automáticamente todas las ediciones.
