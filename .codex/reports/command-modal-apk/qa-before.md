# QA Android — baseline previo a actualización

## Resumen

Inspección **solo lectura** completada en el único dispositivo ADB autorizado, `127.0.0.1:6555` (`Pixel C`, Android 11/API 30). La aplicación instalada es `com.clicpos.app` versión `1.1.405` (`versionCode 1405`). El proceso permaneció estable con PID `23523` y `MainActivity` continuó activa.

No se generó ni instaló un APK, no se modificó configuración y no se ejecutaron ventas, cobros, sincronización manual, reset, borrado ni promoción.

## Identidad operativa permitida

- Terminal: `CAJA 4`.
- Código: `POS-003`.
- Terminal ID: `69dc181d-b85e-486b-8f7f-c0d21b69d298`.
- Modo: `SERVER_ERP`.
- Las cinco copias permitidas del terminal ID consultadas en almacenamiento coinciden.
- No se leyó ni registró ningún PIN, token, credencial, endpoint o dato de cliente.

## Persistencia local

Se abrió una conexión temporal `readonly=true` a `clic_pos_native` mediante el bridge CapacitorSQLite, se ejecutaron únicamente consultas `SELECT` y se cerró esa conexión de lectura.

| Colección | Conteo previo |
|---|---:|
| `products` | 165 |
| `transactions` | 0 |
| `parkedTickets` | 2 |
| `config` | 1 |

SHA-256 del documento `config`, calculado dentro del WebView sin exponer su contenido: `a2239e7706d7fc70d2ad02bcd27aba6dc885742f35d8385a0cb7803134647b2e`.

SHA-256 del `base.apk` actualmente instalado: `7fea820f7a4146b79c35a04fd92413ed01645d2c62f974d1b4d090079d730fdc`.

## Invariantes para el smoke posterior

Después de una futura actualización conservadora deben mantenerse:

- package `com.clicpos.app`;
- terminal ID, nombre, código y modo indicados arriba;
- 165 productos, 0 transacciones y 2 tickets parqueados;
- un documento de configuración con el mismo SHA-256;
- proceso estable y `MainActivity` accesible.

Una diferencia deberá investigarse antes de declarar preservación de datos. Este baseline no autoriza instalación, publicación ni promoción.
