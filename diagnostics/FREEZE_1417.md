# Freeze 1.1.417: captura diagnóstica aislada

Esta rama parte del código funcional de 1.1.417 (`ef0a5e3`). Los únicos cambios son contadores acotados, mapas de fuente, habilitación controlada de DevTools/profileable y un muestreador V8. El artefacto se marca `-diagnostic`; **no es para clientes**. No instalar en la tablet congelada `10.0.0.159:44060` sin una decisión nueva y explícita.

## Preparar un equipo QA

Usar un emulador o equipo de pruebas cuya aplicación y datos puedan modificarse. Antes de instalar, comprobar serial, firma, versión, política LAN y estado previo. Una APK diagnóstica mantiene el package `com.clicpos.app`; no sustituir una instalación con datos importantes ni forzar un downgrade. En una instalación ya activa de QA, la firma debe coincidir y el `versionCode` debe ser monotónico.

Arrancar **control-only** (DevTools y contadores ligeros, sin Zone ni observadores amplios) antes de reproducir el flujo. En un QA sin venta pendiente, cerrar primero solo el proceso de esa app para que el extra de arranque sea efectivo; nunca ejecutar esto en la 159:

```sh
adb -s SERIAL shell am force-stop com.clicpos.app
adb -s SERIAL shell am start -W -n com.clicpos.app/.MainActivity --ez pos_diagnostic_control true
adb -s SERIAL shell cat /proc/net/unix | grep webview_devtools_remote
adb -s SERIAL forward tcp:9229 localabstract:SOCKET_VERIFICADO
curl http://127.0.0.1:9229/json
```

Comprobar que la página DevTools pertenece a `https://localhost` de CLIC-POS en ese serial; no usar el socket de otra WebView. El perfilado no queda activo en reposo. El estado de contadores se lee bajo demanda en DevTools con `globalThis.__CLIC_FREEZE_DIAG__?.snapshot()`; contiene solo nombres fijos y cantidades.

Reproducir carga local, configuración y sync con unos 2,430 artículos/precios, si el entorno QA tiene los mismos datos autorizados. Observar CPU de `CrRendererMain`; al llegar a CPU sostenida alta o pérdida de interacción, ejecutar de inmediato:

```sh
node scripts/diagnostics/sample-freeze.mjs http://127.0.0.1:9229 DIRECTORIO_CAPTURA 8
adb -s SERIAL shell dumpsys meminfo com.clicpos.app
```

El muestreador no ejecuta `Runtime.evaluate` antes de iniciar la captura: conserva el perfil aun si el event loop ya no responde. Después de detener el perfil intenta volcar los contadores; un timeout ahí no invalida `javascript.cpuprofile`. Mantener el proceso vivo hasta guardar logcat acotado, PIDs, CPU por hilo, memoria y timeline.

Usar **los `.map` del APK exacto**, no los de otro build local. Después de la captura:

```sh
node scripts/diagnostics/summarize-freeze.mjs DIRECTORIO_CAPTURA/javascript.cpuprofile RUTA_ASSETS_DEL_APK
```

El analizador rechaza mapas ausentes; verificar además archivo, función y línea fuente del commit del APK. No atribuir causa raíz a un stack minificado o a una mera correlación temporal. Si no aparece el freeze, informar **NO reproducido** y comparar WebView, Android, catálogo, configuración y flags con la 159; no introducir un loop artificial.

No activar `pos_diagnostics=true` salvo una segunda captura justificada: habilita el observador amplio histórico y añade carga. La primera captura debe usar solo `pos_diagnostic_control=true` y el sampler corto.
