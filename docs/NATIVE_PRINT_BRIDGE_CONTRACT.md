# Native Print Bridge Contract (APK/EXE)

Este contrato define lo que debe exponer la capa nativa para que CLIC POS imprima en Android (APK) y Windows/Electron (EXE), con soporte de cola offline.

## Objetivo
- Imprimir etiquetas/tickets en modo nativo sin depender del `window.print` del navegador.
- Descubrir y vincular impresoras (Bluetooth/USB/Red).
- Aceptar comandos ESC/POS en base64 para impresión térmica robusta.

## Objeto global soportado
El bridge puede inyectarse como cualquiera de estos objetos:
- `window.ClicPOSNativePrinter` (recomendado)
- `window.electronAPI.printer`
- `window.electron.printer`
- `window.AndroidPrinter`

## Métodos de impresión (al menos uno requerido)
- `printEscPos(payload)` o `printEscpos(payload)` o `printRaw(payload)`
- `printHtml(payload)` o `print(payload)`

### Payload ESC/POS
```json
{
  "dataBase64": "<escpos_base64>",
  "printerId": "prn_01",
  "printerName": "Zebra BT",
  "printerAddress": "00:11:22:33:44:55",
  "connection": "BLUETOOTH",
  "role": "LABEL",
  "jobType": "LABEL",
  "referenceId": "LBL-123",
  "copies": 1
}
```

### Payload HTML
```json
{
  "html": "<!doctype html>...",
  "printerId": "prn_01",
  "printerName": "EPSON USB",
  "printerAddress": "USB001",
  "connection": "USB",
  "role": "TICKET",
  "jobType": "TICKET",
  "referenceId": "TX-456",
  "copies": 1
}
```

### Respuesta esperada
Puede devolver:
- `true/false`
- o un objeto con `status` en: `success | printed | queued | ok | error`
- opcional: `success`, `printed`, `message`, `errorCode`

## Métodos de periféricos (recomendado)
- `discoverPrinters({ connection })` o `scanPrinters({ connection })` o `listPrinters({ connection })`
- `pairPrinter(payload)` o `connectPrinter(payload)` o `bindPrinter(payload)`

### Respuesta de discovery
- Array de impresoras o `{ devices: [...] }` o `{ printers: [...] }`

Cada item debe incluir idealmente:
```json
{
  "id": "prn_01",
  "name": "Printer Name",
  "connection": "BLUETOOTH",
  "address": "00:11:22:33:44:55",
  "status": "CONNECTED",
  "type": "LABEL"
}
```

## Métodos opcionales de perfil
- `getDeviceProfile()` o `getDeviceInfo()`

Respuesta sugerida:
```json
{
  "profile": "ALL_IN_ONE | HANDHELD | DESKTOP",
  "integratedPrinter": true
}
```

## Comportamiento requerido con offline
- Si no hay conexión o impresora fuera de rango, la app encola en `offline_print_queue`.
- Al recuperar conexión/foco/app activa, reintenta en orden FIFO.
- El bridge no necesita manejar cola interna; la cola principal ya la maneja la app.

## Verificación rápida (QA)
1. Abrir app empaquetada APK/EXE.
2. Revisar consola: `Native print bridge detected`.
3. Probar discovery en `Ajustes > Hardware`.
4. Imprimir etiqueta desde Inventario Móvil.
5. Apagar impresora, enviar impresión (debe encolarse).
6. Encender impresora, esperar reproceso automático (cola vacía).

## Stubs de referencia
- Android WebView: `/Users/felixdiaz/.gemini/antigravity/playground/tensor-planetoid/CLIC-POS/native-stubs/android/ClicPOSNativePrinterBridge.kt`
- Android Bluetooth manager: `/Users/felixdiaz/.gemini/antigravity/playground/tensor-planetoid/CLIC-POS/native-stubs/android/ClicPOSBluetoothPrinterManager.kt`
- Android setup permisos: `/Users/felixdiaz/.gemini/antigravity/playground/tensor-planetoid/CLIC-POS/native-stubs/android/ANDROID_BLUETOOTH_SETUP.md`
- Electron main: `/Users/felixdiaz/.gemini/antigravity/playground/tensor-planetoid/CLIC-POS/native-stubs/electron/main-printer.stub.js`
- Electron preload: `/Users/felixdiaz/.gemini/antigravity/playground/tensor-planetoid/CLIC-POS/native-stubs/electron/preload-printer.stub.js`
