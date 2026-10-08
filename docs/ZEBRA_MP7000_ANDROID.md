# Zebra MP7000 USB en Android

La integración usa el SDK Zebra para USB SNAPI, mediante un plugin Capacitor
`ZebraScanner`. Se activa por terminal en **Hardware → Balanzas → Activar Zebra
MP7000**. Está desactivada por defecto; el valor se conserva en el almacenamiento
local de la WebView y no se propaga a otras cajas.

## Conexión

1. Alimentar el MP7000 con su fuente y conectar su puerto POS al USB host del Android.
2. Configurar el lector como USB SNAPI; no como emulación de teclado.
3. Activar la integración y aceptar el permiso USB que presenta Android.
4. Usar **Probar peso real** para comprobar el enlace. La activación por sí sola no
   demuestra que se haya establecido una sesión o concedido el permiso.
5. Escanear un producto configurado para venta por peso y usar **Re-Leer** si el
   primer peso es inestable. Confirmar después de comprobar el importe.

Los códigos nativos llegan una vez a `processBarcode` en POS y respetan el bloqueo
de sus modales. En historial se conserva el manejo de tickets. Los receptores
de teclado existentes siguen funcionando independientemente del feature flag.

La báscula entrega peso, unidad y estado. Solo se aceptan estados `5` (cero
estable) y `6` (peso estable positivo). El cero no puede confirmarse como cantidad
de venta. Metric se interpreta en kg y English en lb, convertido mediante
`1 lb = 0.45359237 kg`. Unidades desconocidas, sobrecarga, peso negativo,
inestabilidad y respuestas incompletas se rechazan. Las lecturas tienen un límite
de espera de ocho segundos en la interfaz. Una lectura tardía no reemplaza una
entrada manual ni el estado de un modal cerrado. La desconexión invalida el peso.

Se eliminó la generación aleatoria de pesos del modal. Si no se usa el MP7000,
el ingreso manual sigue disponible y se identifica como tal.

## Dependencia fijada

- Fuente: https://github.com/ZebraDevs/Scanner-SDK-for-Android
- Commit: `941027d757ac69807647135558182563adbff24d`
- Archivo: `android_scanner_sdk_demo_app/BarcodeScannerLibrary/barcode_scanner_library_v2.6.29.0-release.aar`
- SHA-256: `cb62c203be9771c3cc168057e62632c04cf69277a054717c8128776acfdbdfa8`
- Licencia distribuida con el repositorio de Zebra: `android/app/libs/ZEBRA-LICENSE.txt`.
- Guía: https://techdocs.zebra.com/dcs/scanners/sdk-android/

El SDK se inicializa en el hilo principal por su registro de lifecycle. Los
comandos y las conexiones se ejecutan en un worker serial. La app mantiene
`allowBackup=false` aunque la librería declare otro valor.

## Evidencia y límites

Inspección por ADB: M27X, Android 9, dirección `10.0.0.99`, APK instalado
`1.1.497` (`1497`). Android enumera un lector Symbol con VID/PID `05E0:1900`,
interfaz SNAPI. Esto confirma transporte USB; el modelo concreto y la disponibilidad
de la báscula deben confirmarse mediante el SDK y una prueba física.

El cambio se desarrolla desde `origin/main` según el flujo actual. Esa base conserva
`versionName=1.0.40`, `versionCode=41`, y no equivale automáticamente al APK instalado.
Este PR no cambia versiones ni genera o instala un APK. Antes de un candidato
firmado debe comprobarse la trazabilidad y preservación de todos los fixes del
APK 1.1.497 conforme al protocolo de release; no promover esta base sin esa puerta.

## Validación

- `npm run build`.
- `npx tsx --test tests/*.test.ts`.
- `npx cap sync android` y `./gradlew :app:compileDebugJavaWithJavac` (compilación,
  sin empaquetado ni firma).
- ESLint no es ejecutable en esta base: falta `eslint.config.*`.

QA física pendiente para el APK candidato:

1. Activación desactivada: operación de teclado y venta manual conservadas.
2. Aceptar/rechazar permiso USB; mostrar un error legible al rechazarlo.
3. Leer el mismo producto varias veces y comprobar una incorporación por lectura.
4. Pesar una masa conocida en kg y lb y verificar peso y total.
5. Comprobar cero, inestabilidad y sobrecarga sin permitir confirmar peso inseguro.
6. Desconectar/reconectar, reabrir el modal y reiniciar la app.
7. Escribir peso manual mientras hay una lectura pendiente; no debe sobrescribirse.
8. Verificar que los códigos no agregan productos con un modal de pago o peso abierto.
9. Ejecutar las puertas de release, firma, persistencia y canario del proyecto antes
   de promover un APK; no considerar esta compilación una validación física.
