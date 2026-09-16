# Checklist release

Cada punto pertinente requiere esperado/observado y enlace a evidencia para candidate SHA. N/A solo si analista propone y validador independiente justifica ausencia de impacto; nunca por falta de entorno. Checklist completada no sustituye ejecución.

- [ ] Expedido taskId/base/candidate/plan, autores y aprobador independiente verificables.
- [ ] workflow-gate verify PASS para SHA candidato con todos los gates requeridos y evidencias presentes.
- [ ] Review/QA/performance independiente, ningún autor aprueba su código; FAIL/BLOCKED/PENDING bloquean.
- [ ] Commit/branch push y PR hacia develop, sin push main ni merge directo main.
- [ ] Solo develop oficial o source explícita de release conforme protocolo; nada solo en runtime/worktree firmada.
- [ ] Constitución docs/APK_RELEASE_CONSTITUTION.md y baseline sin relajar; cambios de presupuesto requieren PR separado y autorización explícita.
- [ ] Golden APK prebuild gate pertinente pasó sin --skip-tests; promote requiere evidencia runtime propia.
- [ ] Worktree firmada limpia y código/HEAD alineado a source SHA antes de build; versión formalizada y monotónica.
- [ ] Node/JDK/SDK, flags release/diagnóstico/LAN HTTP y build coinciden con escenario probado.
- [ ] APK firma/certificado/hash/package y versión registrados; versionCode/versionName alineados repos/worktree.
- [ ] Upgrade install -r sin pérdida, topologías/smoke completos, cero crash/ANR/pendientes no resueltos según baseline.
- [ ] Print/fiscal/offline/sync/auth y datos históricos después de upgrade verificados.
- [ ] Promote/runtime evidence, PRs, rollback y fuente archivados; merge fallido revert del merge commit mediante PR.
- [ ] No publicar/instalar/desplegar si esta tarea solo solicita documentación.

- [ ] INTERNAL_TESTING_PASSED con artefacto exacto publicado/descargado/probado; gates internal→deployment→testing→production acumulativos.
- [ ] Producción aprobada por release independiente de build/developer/deploy/testing; ejecutor release distinto de su aprobador.
- [ ] verify --stage production antes de publicar; verify --stage released requiere evidencia real ambiente PRODUCTION.
- [ ] No available por aprobado-interno; internal-deploy nunca promueve producción.
