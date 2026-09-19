# APK candidato 1.1.407 — modal de comandas

Solicitud: generar el APK con las mejoras e instalarlo solo en el emulador; pruebas Cliente y Master pendientes.

- Fuente exacta: `00b687112522bfa6eb872fcf2f9c8f6b6fa30b31`.
- Rama: `feature/android-command-modal-pilot`, creada desde `origin/develop` e integrada por fast-forward con la mejora revisada de #743.
- PR: https://github.com/fdiazinoa/CLIC-POS/pull/744 (draft hacia develop). No se fusionó ni publicó producción.
- Código: `1407`; paquete `com.clicpos.app`; tamaño `33391757` bytes.
- APK SHA-256: `8d2b2d55aadb9eee6013637a9d52701b96afb204f08d424f5ce79337e419f9e5`.
- Certificado CN=CLIC POS, SHA-256: `17746ded8c0d08a839ac5c3e84903b46c6f537f798d053a94e021355af188e2c`.

Incluye el modal por pasos, selección múltiple/paginación, validaciones, nota y resumen Base/Extras/Total; preserva el arreglo de sincronización de modificadores de #742 y los hotfix previos. No cambia reglas de precio ni el payload de venta.

Validaciones previas: npm ci y build web PASS en fuente limpia; prebuild 117/117; operacional y regresiones específicas 60/60. El script canónico repitió prebuild en la worktree de firma, completó Gradle y verificó política LAN y assets. RELEASE independiente verificó firma, manifiesto, 44 assets por hash y ancestralidad.

El primer intento terminó antes de Gradle por DNS de GitHub. Se consultó DNS y se aplicó http.curloptResolve exclusivamente al proceso Git, manteniendo verificación TLS y sin modificar configuración global. El segundo intento generó el único APK nuevo.

Instalación autorizada mediante helper canónico con adb install -r en 127.0.0.1:6555: PASS, 1.1.405/1405 → 1.1.407/1407. Sin uninstall, clear, downgrade, ventas ni cambios de configuración. Smoke y comparación de datos: PASS_WITH_OBSERVATION (ver qa-after.md/json). Modal real en ambas orientaciones, RD$640, bebida/nota y cancelación correctos; 16 segundos sin errores críticos. Identidad y conteos 165/0/2 preservados. El hash de configuración cambió y no se atribuye el campo exacto: no se declara configuración idéntica.

Estado: candidato para emulador. Cliente y Master quedan pendientes; no promoción. release-evidence.json conserva métricas no observadas como null y contratos/topologías sin demostrar como false.

Roles: developer /root/modal_developer (versión), RELEASE /root/release (revisión independiente), QA /root/qa (antes/después); /root coordina y ejecuta el script de build/install autorizado. Los informes de la mejora funcional están en ../command-modal-flow.
