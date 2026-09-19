# Evaluación independiente RELEASE

- Tarea: `sync-command-modifiers`.
- Rol / agentId-sessionId: RELEASE, `/root/release`, sesión independiente de autores y del coordinador.
- Base: `a0cfcae1ccc3086d4ce64e099ff0ee232a706a79`.
- Candidato corroborado en HEAD: `70498f5df019d6ea802b4acd6c7a25cc96db405f`.
- Estado: **BLOCKED**. Último estado validado por evidencia consultada: REVIEW PASS del candidato. Etapa bloqueada: validación de código completa y toda etapa posterior de release.
- Contrato leído: AGENTS.md, WORKFLOW.md, `.codex/agents/release.md`, `.codex/checklists/release.md` y reportes analysis, plan-review, review, performance y sync-validation del expediente.
- Limitación del cliente: rol delegado por instrucciones Markdown en sesión independiente; no se afirma selección nativa de un perfil TOML ni firma criptográfica de identidad.

## Decisión y alcance

El REVIEW PASS permite continuar QA independiente, pero no acredita CODE_VALIDATED ni APPROVED_FOR_INTERNAL_TESTING. Un PR **draft hacia develop** puede documentar el cambio y estos bloqueos para revisión; no constituye aprobación para merge, APK, instalación o publicación. Este rol no ejecutó push ni creó PR y no dispone todavía de su URL como evidencia.

La autorización comunicada corresponde a QA sobre el emulador y APK existente **1.1.405**. Esa versión es contexto comunicado por el coordinador, no un manifiesto de artefacto candidato verificado por RELEASE. No existe evidencia consultada que vincule los bytes de ese APK al SHA candidato. Por tanto, una prueba exitosa allí no valida este nuevo código. No se generó, instaló, firmó, promovió ni desplegó un APK durante esta evaluación.

## Bloqueos para código

1. Falta expediente consolidado y resultado `workflow-gate verify --stage code` PASS para el SHA exacto con todos los gates requeridos y sus evidencias independientes. No se ejecuta verificación contra un expediente inventado o incompleto.
2. QA funcional/regresión del candidato sigue en curso según el coordinador; no se recibió informe final PASS. REVIEW registra tres fallos de suites dependientes de `CLIC_ERP_REVIEW_PATH` ausente: deben conservarse hasta resolución y repetición acreditadas.
3. SYNC-VALIDATOR aún no entregó resultado final del SHA actual. El informe disponible registra bloqueo del recorrido CONFIG_PUSH_V2 web en la base (`RECOVERY_ATOMIC_STORAGE_UNAVAILABLE`), y pendientes de entorno/ambos sentidos/red/ACK. Su ejecución con fallo esperado no equivale a snapshot PASS.
4. PERFORMANCE está BLOCKED: sin mediciones comparables suficientes baseline/candidate ni QA funcional previo aprobado. Las métricas n/p50/p95/p99/max siguen no medidas.
5. Falta evidencia Android/WebView del candidato y la topología de cliente físico requerida por el plan. El emulador con otro APK y los adaptadores simulados no satisfacen estos puntos. Ausencia de cliente no habilita NOT REQUIRED.

Los informes en curso pueden actualizar estos puntos; esta evaluación no anticipa sus resultados. El incidente original de Caja 4 y el modal ya abierto permanecen fuera de cualquier afirmación de corrección definitiva.

## Bloqueos adicionales para APK y etapas posteriores

No hay manifiesto `approvedArtifact` candidato verificado: faltan filename/localPath, versionName/versionCode, buildId/buildDate, sizeBytes, SHA256 de bytes, certificado SHA256, paquete, tipo release y evidencia de flags instrumented/diagnostic/temporary=false vinculados al commit exacto. No se inventa ninguno ni se elige el APK más reciente.

También faltan alineación/limpieza de source oficial y worktree firmada, versión monotónica, prebuild sin omitir tests, firma/metadatos corroborados, aprobación independiente del build, upgrade sin pérdida y smoke/topologías/runtime propios de ese APK. No hay gates internal, deployment, testing, production o released PASS, ni artefacto interno publicado/descargado/probado, ni autorización para generar o desplegarlo en esta tarea.

Para retomar código: completar evidencia del candidato y resolver los gates bloqueados antes de verificar stage code. Para retomar release: además se necesita una solicitud autorizada de build/deploy, artefacto exacto y aprobaciones acumulativas independientes conforme WORKFLOW y constitución APK. La falta de autorización de release delimita alcance; no se solicita aprobación para ampliar esta tarea ni se realizan acciones externas.
