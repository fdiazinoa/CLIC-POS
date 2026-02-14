# Android Bluetooth Setup (Real ESC/POS)

Este archivo describe la configuración mínima para usar `AndroidPrinterBridge` con impresión térmica Bluetooth real.

## 1) AndroidManifest.xml

```xml
<!-- Android 12+ -->
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />

<!-- Android <= 11 -->
<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />

<!-- Solo necesario si harás discovery activo en Android <= 11 -->
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" android:maxSdkVersion="30" />

<uses-feature android:name="android.hardware.bluetooth" android:required="false" />
```

## 2) Solicitar permisos en runtime (Android 12+)

```kotlin
private val btPermissions = arrayOf(
    android.Manifest.permission.BLUETOOTH_SCAN,
    android.Manifest.permission.BLUETOOTH_CONNECT
)

private fun ensureBluetoothPermissions(activity: Activity, requestCode: Int = 2001): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true

    val denied = btPermissions.filter {
        activity.checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED
    }

    if (denied.isEmpty()) return true

    activity.requestPermissions(denied.toTypedArray(), requestCode)
    return false
}
```

## 3) Vincular bridge al WebView

```kotlin
val bridge = AndroidPrinterBridge(applicationContext)

webView.settings.javaScriptEnabled = true
webView.addJavascriptInterface(bridge, "AndroidPrinter")
AndroidPrinterBridge.injectContractShim(webView)
```

## 4) Flujo recomendado
- Pedir permisos antes de cargar módulo Inventario Móvil.
- Validar que Bluetooth esté encendido.
- Usar discovery para listar `bondedDevices`.
- Ejecutar pairing desde UI si no hay impresora guardada.
- Imprimir con `printEscPos` como ruta principal.

## 5) Comportamiento del bridge
- Si no hay impresora conectada, el bridge devuelve `queued`.
- Mantiene cola en memoria de trabajos ESC/POS y la drena cuando reconecta.
- Soporta aliases del contrato:
  - `printEscPos / printEscpos / printRaw`
  - `discoverPrinters / scanPrinters / listPrinters`
  - `pairPrinter / connectPrinter / bindPrinter`
