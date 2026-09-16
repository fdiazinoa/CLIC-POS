# Instalación ampliada: auditoría y plan

Task process-internal-release; base develop 669f9624c85de40129169e6779aa6983f1441fea; fecha 2026-09-16. Alcance permitido: docs, AGENTS, WORKFLOW y .codex; no código funcional POS/Cloud, no optimización/build APK/deploy/release producción.

Auditoría: 1055 archivos, 818 fuentes escaneadas; lectura profunda original + delta App/master routing/login/instrumentación; Cloud-Admin audit independiente /root/cloud_audit SHA 67c50259 sin secretos ni mutaciones. CLIC-ERP Inbox inspección parcial local SHA 29653355, deploy receiver no certificado.

Analyst /root/procedure_analysis: causa raíz procedimiento antiguo terminaba antes de deploy y releaseEligible ambiguo. Plan: nueve roles/once checklists/reportes, tres mapas especializados, risk matrix conservada para compartidos/desconocidos, sync independiente, schema2 etapas y artefacto exacto/checksum, docs blockers Cloud.

Plan aprobado independientemente por /root/workflow_review para base anterior: PLAN PASS, condiciones code PASS no autoriza release, suites/independencia/hash vinculados, upload/canal no encontrados BLOCKED. Autor tooling/documentación: /root; ningún PASS posterior lo firma /root. Estado primera instalación no debe confundirse con gates runtime de un APK.

Resultados y reconfirmación del candidato se registrarán en el PR; esta sección no contiene un PASS no ejecutado.

## Checks locales observados

npm ci PASS. npm run build PASS (tsc -b + Vite, warnings de tamaño chunks existentes). npm run lint exit2/BLOCKED por eslint.config ausente; no se corrige POS/dependencias/config ajenas durante instalación. Tooling 18/18 PASS incluyendo inspector de bytes local, gates acumulativos/identidad/permisos y salida symlink; review preliminar independiente pasó 17 tests previos. Las nuevas pruebas ejercitan contrato del procedimiento, no APK operativo. Ningún APK existente se publicó ni generó build Android.
