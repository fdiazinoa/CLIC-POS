package com.clicpos.nativeprinter

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbManager
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.Socket
import java.net.URL
import java.net.URLEncoder
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.json.JSONObject

/**
 * Android bridge real para impresion Bluetooth ESC/POS.
 *
 * Uso recomendado en Activity/Fragment:
 * 1) webView.settings.javaScriptEnabled = true
 * 2) val bridge = AndroidPrinterBridge(applicationContext)
 * 3) webView.addJavascriptInterface(bridge, "AndroidPrinter")
 * 4) AndroidPrinterBridge.injectContractShim(webView)
 */
class AndroidPrinterBridge(context: Context) {
    companion object {
        private const val DGII_LOG_TAG = "ClicPOSDGII"

        /**
         * Shim para exponer contrato JS unificado como window.ClicPOSNativePrinter.
         */
        @JvmStatic
        fun injectContractShim(webView: WebView) {
            val script = """
                (function () {
                  if (!window.AndroidPrinter) return;
                  var parseResult = function (value) {
                    if (!value) return { status: 'error', success: false, printed: false, message: 'Empty native response' };
                    if (typeof value === 'string') {
                      try { return JSON.parse(value); } catch (e) { return { status: 'error', success: false, printed: false, message: String(value) }; }
                    }
                    return value;
                  };

                  var call = function (method, payload) {
                    if (!window.AndroidPrinter || typeof window.AndroidPrinter[method] !== 'function') {
                      return Promise.resolve({ status: 'error', success: false, printed: false, message: 'Missing native method: ' + method });
                    }
                    var raw = window.AndroidPrinter[method](JSON.stringify(payload || {}));
                    return Promise.resolve(parseResult(raw));
                  };

                  window.ClicPOSNativePrinter = {
                    platform: 'android',
                    validateDgiiRnc: function (payload) { return call('validateDgiiRnc', payload); },
                    printEscPos: function (payload) { return call('printEscPos', payload); },
                    printEscpos: function (payload) { return call('printEscpos', payload); },
                    printRaw: function (payload) { return call('printRaw', payload); },
                    printHtml: function (payload) { return call('printHtml', payload); },
                    print: function (payload) { return call('print', payload); },
                    discoverPrinters: function (payload) { return call('discoverPrinters', payload); },
                    scanPrinters: function (payload) { return call('scanPrinters', payload); },
                    listPrinters: function (payload) { return call('listPrinters', payload); },
                    pairPrinter: function (payload) { return call('pairPrinter', payload); },
                    connectPrinter: function (payload) { return call('connectPrinter', payload); },
                    bindPrinter: function (payload) { return call('bindPrinter', payload); },
                    testPrinter: function (payload) { return call('testPrinter', payload); },
                    testPrinterConnection: function (payload) { return call('testPrinterConnection', payload); },
                    getPrinterStatus: function (payload) { return call('getPrinterStatus', payload); },
                    checkStatus: function (payload) { return call('checkStatus', payload); },
                    getDeviceProfile: function () { return Promise.resolve(parseResult(window.AndroidPrinter.getDeviceProfile())); },
                    getDeviceInfo: function () { return Promise.resolve(parseResult(window.AndroidPrinter.getDeviceInfo())); },
                    startKdsServer: function (payload) { return call('startKdsServer', payload); },
                    stopKdsServer: function (payload) { return call('stopKdsServer', payload); },
                    getKdsServerStatus: function (payload) { return call('getKdsServerStatus', payload); },
                    startMasterServer: function (payload) { return call('startMasterServer', payload); },
                    updateMasterServerConfig: function (payload) { return call('updateMasterServerConfig', payload); },
                    stopMasterServer: function (payload) { return call('stopMasterServer', payload); },
                    getMasterServerStatus: function (payload) { return call('getMasterServerStatus', payload); },
                    discoverMasterServers: function (payload) { return call('discoverMasterServers', payload); },
                    discoverFingerprintReaders: function (payload) { return call('discoverFingerprintReaders', payload); },
                    scanFingerprintReaders: function (payload) { return call('scanFingerprintReaders', payload); },
                    testFingerprintReader: function (payload) { return call('testFingerprintReader', payload); }
                  };
                })();
            """.trimIndent()

            webView.post {
                webView.evaluateJavascript(script, null)
            }
        }
    }

    private val appContext = context.applicationContext
    private val clipboardManager = appContext.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager

    private val manager = ClicPOSBluetoothPrinterManager(appContext)
    private val usbPermissionAction = "${appContext.packageName}.USB_PRINTER_PERMISSION"
    private val dgiiUrl = "https://dgii.gov.do/app/WebApps/ConsultasWeb2/ConsultasWeb/consultas/rnc.aspx"

    @JavascriptInterface
    fun printEscPos(payloadJson: String?): String {
        return try {
            val payload = JSONObject(payloadJson ?: "{}")
            val dataBase64 = payload.optString("dataBase64", "")
            if (dataBase64.isBlank()) {
                return error("Missing dataBase64", "PAYLOAD_INVALID")
            }

            val rawBytes = Base64.decode(dataBase64, Base64.DEFAULT)
            val copies = payload.optInt("copies", 1).coerceIn(1, 10)
            val connection = payload.optString("connection", "BLUETOOTH").uppercase()
            val result = if (connection == "NETWORK") {
                routeEscPosPrint(
                    rawBytes = repeatNetworkPayload(rawBytes, copies),
                    connection = connection,
                    printerAddress = payload.optString("printerAddress", null),
                    printerName = payload.optString("printerName", null),
                    printerId = payload.optString("printerId", null)
                ).withCopyMessage(copies)
            } else {
                printCopies(copies) {
                    routeEscPosPrint(
                        rawBytes = rawBytes,
                        connection = connection,
                        printerAddress = payload.optString("printerAddress", null),
                        printerName = payload.optString("printerName", null),
                        printerId = payload.optString("printerId", null)
                    )
                }
            }
            toJson(result)
        } catch (e: IllegalArgumentException) {
            error(e.message ?: "Invalid base64 payload", "PAYLOAD_INVALID")
        } catch (e: Exception) {
            error(e.message ?: "Native ESC/POS error", "PRINT_ESC_POS_ERROR")
        }
    }

    @JavascriptInterface
    fun printEscpos(payloadJson: String?): String = printEscPos(payloadJson)

    @JavascriptInterface
    fun printRaw(payloadJson: String?): String = printEscPos(payloadJson)

    @JavascriptInterface
    fun printHtml(payloadJson: String?): String {
        return try {
            val payload = JSONObject(payloadJson ?: "{}")
            val html = payload.optString("html", "")
            if (html.isBlank()) {
                return error("Missing html", "PAYLOAD_INVALID")
            }

            val connection = payload.optString("connection", "BLUETOOTH").uppercase()
            val printerAddress = payload.optString("printerAddress", null)
            val printerName = payload.optString("printerName", null)
            val printerId = payload.optString("printerId", null)
            val copies = payload.optInt("copies", 1).coerceIn(1, 10)

            val result = printCopies(copies) {
                if (connection == "BLUETOOTH") {
                    manager.printHtmlAsText(
                        html = html,
                        printerAddress = printerAddress,
                        printerName = printerName,
                        printerId = printerId
                    )
                } else {
                    routeEscPosPrint(
                        rawBytes = htmlToPlainTextBytes(html),
                        connection = connection,
                        printerAddress = printerAddress,
                        printerName = printerName,
                        printerId = printerId
                    )
                }
            }
            toJson(result)
        } catch (e: Exception) {
            error(e.message ?: "Native HTML print error", "PRINT_HTML_ERROR")
        }
    }

    @JavascriptInterface
    fun print(payloadJson: String?): String = printHtml(payloadJson)

    @JavascriptInterface
    fun discoverPrinters(payloadJson: String?): String {
        return try {
            val payload = JSONObject(payloadJson ?: "{}")
            val connection = payload.optString("connection", "BLUETOOTH").uppercase()
            val devices = when (connection) {
                "BLUETOOTH" -> manager.discoverBondedPrinters().map { printer ->
                    JSONObject()
                        .put("id", printer.id)
                        .put("name", printer.name)
                        .put("connection", printer.connection)
                        .put("address", printer.address)
                        .put("status", printer.status)
                        .put("type", printer.type)
                }
                "USB" -> discoverUsbPrinters()
                else -> emptyList()
            }
            JSONObject()
                .put("devices", JSONArray().apply {
                    devices.forEach { device -> put(device) }
                })
                .toString()
        } catch (e: Exception) {
            JSONObject()
                .put("devices", JSONArray())
                .put("error", e.message ?: "DISCOVERY_ERROR")
                .toString()
        }
    }

    @JavascriptInterface
    fun scanPrinters(payloadJson: String?): String = discoverPrinters(payloadJson)

    @JavascriptInterface
    fun listPrinters(payloadJson: String?): String = discoverPrinters(payloadJson)

    @JavascriptInterface
    fun discoverFingerprintReaders(payloadJson: String?): String {
        return try {
            val payload = JSONObject(payloadJson ?: "{}")
            val connection = payload.optString("connection", "USB").uppercase()
            val devices = when (connection) {
                "USB" -> discoverUsbFingerprintReaders()
                else -> emptyList()
            }
            JSONObject()
                .put("devices", JSONArray().apply { devices.forEach { put(it) } })
                .toString()
        } catch (e: Exception) {
            JSONObject()
                .put("devices", JSONArray())
                .put("error", e.message ?: "FP_DISCOVERY_ERROR")
                .toString()
        }
    }

    @JavascriptInterface
    fun scanFingerprintReaders(payloadJson: String?): String = discoverFingerprintReaders(payloadJson)

    @JavascriptInterface
    fun testFingerprintReader(payloadJson: String?): String {
        return try {
            val payload = JSONObject(payloadJson ?: "{}")
            val address = payload.optString("address", "").trim()
            val id = payload.optString("id", "").trim()
            val device = findUsbFingerprintDeviceForTest(address, id)
                ?: return JSONObject()
                    .put("status", "OFFLINE")
                    .put("success", false)
                    .put("message", "Lector USB no encontrado. Verifique el cable, OTG y que el dispositivo aparezca en la búsqueda.")
                    .toString()

            val usbManager = appContext.getSystemService(Context.USB_SERVICE) as? UsbManager
                ?: return JSONObject()
                    .put("status", "OFFLINE")
                    .put("success", false)
                    .put("message", "USB host no disponible.")
                    .toString()

            if (!usbManager.hasPermission(device)) {
                requestUsbPermission(usbManager, device)
            }
            if (!usbManager.hasPermission(device)) {
                return JSONObject()
                    .put("status", "OFFLINE")
                    .put("success", false)
                    .put("message", "Permiso USB pendiente. Acepte el diálogo del sistema y pulse Probar de nuevo.")
                    .toString()
            }

            if (device.vendorId != DigitalPersonaUru4500.VENDOR_ID ||
                device.productId != DigitalPersonaUru4500.PRODUCT_ID) {
                return JSONObject()
                    .put("status", "UNKNOWN")
                    .put("success", false)
                    .put("message", "El lector fue detectado, pero la captura abierta solo está habilitada para DigitalPersona U.are.U 4500 (05ba:000a).")
                    .toString()
            }

            val capture = DigitalPersonaUru4500(usbManager, device).use { reader -> reader.capture() }
            Log.i(
                "ClicPOSFingerprint",
                "capture_ok width=${capture.width} height=${capture.height} lines=${capture.capturedLines} encrypted=${capture.encrypted} contrast=${capture.contrast}",
            )
            JSONObject()
                .put("status", "ONLINE")
                .put("success", true)
                .put("captured", true)
                .put("width", capture.width)
                .put("height", capture.height)
                .put("capturedLines", capture.capturedLines)
                .put("encrypted", capture.encrypted)
                .put("contrast", capture.contrast)
                .put("message", "Huella capturada correctamente (${capture.width}×${capture.height}, ${capture.capturedLines} líneas).")
                .toString()
        } catch (e: Exception) {
            Log.e("ClicPOSFingerprint", "capture_failed: ${e.message}", e)
            JSONObject()
                .put("status", "OFFLINE")
                .put("success", false)
                .put("message", e.message ?: "FP_TEST_ERROR")
                .toString()
        }
    }

    @JavascriptInterface
    fun debugLog(payloadJson: String?): String {
        return try {
            val payload = JSONObject(payloadJson ?: "{}")
            val tag = payload.optString("tag", "ClicPOSDebug").ifBlank { "ClicPOSDebug" }
            val message = payload.optString("message", "Native debug log").ifBlank { "Native debug log" }
            val data = payload.opt("data")
            val suffix = when {
                data == null || data == JSONObject.NULL -> ""
                data is JSONObject || data is JSONArray -> " ${data}"
                else -> " ${data.toString()}"
            }

            Log.i(tag, message + suffix)

            JSONObject()
                .put("success", true)
                .put("tag", tag)
                .put("message", message)
                .toString()
        } catch (e: Exception) {
            Log.w("ClicPOSDebug", "debugLog bridge failed: ${e.message}", e)
            JSONObject()
                .put("success", false)
                .put("error", e.message ?: "DEBUG_LOG_ERROR")
                .toString()
        }
    }

    @JavascriptInterface
    fun pairPrinter(payloadJson: String?): String {
        return try {
            val payload = JSONObject(payloadJson ?: "{}")
            val connection = payload.optString("connection", "BLUETOOTH").uppercase()
            val printer = when (connection) {
                "BLUETOOTH" -> {
                    val address = payload.optString("address", payload.optString("id", null))
                    val name = payload.optString("name", null)
                    val paired = manager.pairPrinter(address = address, fallbackName = name)
                    JSONObject()
                        .put("id", paired.id)
                        .put("name", paired.name)
                        .put("connection", paired.connection)
                        .put("address", paired.address)
                        .put("status", paired.status)
                        .put("type", paired.type)
                }
                "USB" -> resolveUsbPrinter(
                    address = payload.optString("address", payload.optString("id", null)),
                    fallbackName = payload.optString("name", null)
                )
                "NETWORK" -> JSONObject()
                    .put("id", payload.optString("id", payload.optString("address", payload.optString("name", "network-printer"))))
                    .put("name", payload.optString("name", "Impresora por IP"))
                    .put("connection", "NETWORK")
                    .put("address", payload.optString("address", null))
                    .put("status", "CONNECTED")
                    .put("type", payload.optString("type", "TICKET"))
                else -> return error("Unsupported connection: $connection", "UNSUPPORTED_CONNECTION")
            }

            JSONObject().put("printer", printer).toString()
        } catch (e: Exception) {
            error(e.message ?: "PAIR_ERROR", "PAIR_ERROR")
        }
    }

    @JavascriptInterface
    fun connectPrinter(payloadJson: String?): String = pairPrinter(payloadJson)

    @JavascriptInterface
    fun bindPrinter(payloadJson: String?): String = pairPrinter(payloadJson)

    @JavascriptInterface
    fun testPrinter(payloadJson: String?): String = testPrinterConnection(payloadJson)

    @JavascriptInterface
    fun testPrinterConnection(payloadJson: String?): String {
        return try {
            val payload = JSONObject(payloadJson ?: "{}")
            val connection = payload.optString("connection", "BLUETOOTH").uppercase()
            val address = payload.optString("printerAddress", payload.optString("address", payload.optString("printerId", payload.optString("id", null))))
            val name = payload.optString("printerName", payload.optString("name", null))

            when (connection) {
                "BLUETOOTH" -> toJson(manager.testConnection(address, name, payload.optString("printerId", payload.optString("id", null))))
                "USB" -> {
                    val usbDevice = findUsbDevice(address, name)
                    if (usbDevice != null) {
                        JSONObject()
                            .put("status", "ONLINE")
                            .put("success", true)
                            .put("message", "Puerto USB detectado: ${usbDevice.deviceName}")
                            .toString()
                    } else {
                        JSONObject()
                            .put("status", "OFFLINE")
                            .put("success", false)
                            .put("message", "No se detectó una impresora USB conectada.")
                            .toString()
                    }
                }
                "NETWORK" -> {
                    val endpoint = parseNetworkEndpoint(address)
                    val online = endpoint != null && testTcpEndpoint(endpoint.first, endpoint.second)
                    JSONObject()
                        .put("status", if (online) "ONLINE" else "OFFLINE")
                        .put("success", online)
                        .put("message", if (online) "Conexión IP exitosa a ${endpoint?.first}:${endpoint?.second ?: 9100}" else "No se pudo conectar a la impresora IP.")
                        .toString()
                }
                else -> JSONObject()
                    .put("status", "UNKNOWN")
                    .put("success", false)
                    .put("message", "Modo de conexión no soportado: $connection")
                    .toString()
            }
        } catch (e: Exception) {
            JSONObject()
                .put("status", "OFFLINE")
                .put("success", false)
                .put("message", e.message ?: "No se pudo probar la conexión.")
                .toString()
        }
    }

    @JavascriptInterface
    fun getPrinterStatus(payloadJson: String?): String = testPrinterConnection(payloadJson)

    @JavascriptInterface
    fun checkStatus(payloadJson: String?): String = testPrinterConnection(payloadJson)

    @JavascriptInterface
    fun getDeviceProfile(): String {
        return JSONObject()
            .put("profile", "HANDHELD")
            .put("integratedPrinter", false)
            .toString()
    }

    @JavascriptInterface
    fun getDeviceInfo(): String {
        val packageInfo = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                appContext.packageManager.getPackageInfo(
                    appContext.packageName,
                    PackageManager.PackageInfoFlags.of(0)
                )
            } else {
                @Suppress("DEPRECATION")
                appContext.packageManager.getPackageInfo(appContext.packageName, 0)
            }
        } catch (_: Exception) {
            null
        }

        val versionName = packageInfo?.versionName ?: "0.0.0"
        val versionCode = if (packageInfo != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                packageInfo.longVersionCode
            } else {
                @Suppress("DEPRECATION")
                packageInfo.versionCode.toLong()
            }
        } else {
            0L
        }

        val localIps = getLocalIpv4Addresses()
        val preferredLocalIp = localIps.firstOrNull()

        return JSONObject()
            .put("profile", "HANDHELD")
            .put("integratedPrinter", false)
            .put("platform", "android")
            .put("packageName", appContext.packageName)
            .put("versionName", versionName)
            .put("versionCode", versionCode)
            .put("localIp", preferredLocalIp)
            .put("localIps", JSONArray(localIps))
            .toString()
    }

    @JavascriptInterface
    fun startKdsServer(payloadJson: String?): String {
        val port = runCatching {
            val payload = if (payloadJson.isNullOrBlank()) JSONObject() else JSONObject(payloadJson)
            payload.optInt("port", 8001)
        }.getOrDefault(8001)

        return ClicPOSKdsHttpServer.start(appContext, port).toString()
    }

    @JavascriptInterface
    fun stopKdsServer(payloadJson: String?): String {
        return ClicPOSKdsHttpServer.stop().toString()
    }

    @JavascriptInterface
    fun getKdsServerStatus(payloadJson: String?): String {
        return ClicPOSKdsHttpServer.status(appContext).toString()
    }

    @JavascriptInterface
    fun startMasterServer(payloadJson: String?): String {
        val payload = runCatching {
            if (payloadJson.isNullOrBlank()) JSONObject() else JSONObject(payloadJson)
        }.getOrDefault(JSONObject())
        val port = payload.optInt("port", 3001)
        val config = payload.optJSONObject("config")
        val users = payload.optJSONArray("users")
        val rooms = payload.optJSONArray("rooms")
        val tables = payload.optJSONArray("tables")
        val parkedTickets = payload.optJSONArray("parkedTickets")
        val catalogs = payload.optJSONObject("catalogs")
        val restaurantRevision = payload.optLong("restaurantRevision", 0)
        return ClicPOSMasterHttpServer.start(
            appContext,
            port,
            config,
            users,
            rooms,
            tables,
            parkedTickets,
            catalogs,
            restaurantRevision
        ).toString()
    }

    @JavascriptInterface
    fun updateMasterServerConfig(payloadJson: String?): String {
        val payload = runCatching {
            if (payloadJson.isNullOrBlank()) JSONObject() else JSONObject(payloadJson)
        }.getOrDefault(JSONObject())
        val config = payload.optJSONObject("config") ?: JSONObject()
        val users = payload.optJSONArray("users")
        val rooms = payload.optJSONArray("rooms")
        val tables = payload.optJSONArray("tables")
        val parkedTickets = payload.optJSONArray("parkedTickets")
        val catalogs = payload.optJSONObject("catalogs")
        val restaurantRevision = payload.optLong("restaurantRevision", 0)
        return ClicPOSMasterHttpServer.updateConfig(
            config,
            users,
            rooms,
            tables,
            parkedTickets,
            catalogs,
            restaurantRevision
        ).toString()
    }

    @JavascriptInterface
    fun stopMasterServer(payloadJson: String?): String {
        return ClicPOSMasterHttpServer.stop().toString()
    }

    @JavascriptInterface
    fun getMasterServerStatus(payloadJson: String?): String {
        return ClicPOSMasterHttpServer.status(appContext).toString()
    }

    @JavascriptInterface
    fun discoverMasterServers(payloadJson: String?): String {
        val payload = runCatching {
            if (payloadJson.isNullOrBlank()) JSONObject() else JSONObject(payloadJson)
        }.getOrDefault(JSONObject())
        return ClicPOSMasterDiscovery.discover(
            appContext,
            payload.optLong("timeoutMs", 3_000L)
        ).toString()
    }

    @JavascriptInterface
    fun getMasterRestaurantState(payloadJson: String?): String {
        return ClicPOSMasterHttpServer.getRestaurantState().toString()
    }

    @JavascriptInterface
    fun acquireMasterTableLock(payloadJson: String?): String {
        val payload = runCatching {
            if (payloadJson.isNullOrBlank()) JSONObject() else JSONObject(payloadJson)
        }.getOrDefault(JSONObject())
        return ClicPOSMasterHttpServer.acquireTableEditLock(payload).apply {
            remove("_httpStatus")
        }.toString()
    }

    @JavascriptInterface
    fun releaseMasterTableLock(payloadJson: String?): String {
        val payload = runCatching {
            if (payloadJson.isNullOrBlank()) JSONObject() else JSONObject(payloadJson)
        }.getOrDefault(JSONObject())
        return ClicPOSMasterHttpServer.releaseTableEditLock(payload).apply {
            remove("_httpStatus")
        }.toString()
    }

    @JavascriptInterface
    fun readClipboard(): String {
        return try {
            if (!clipboardManager.hasPrimaryClip()) {
                return error("Portapapeles vacío.", "CLIPBOARD_EMPTY")
            }

            val clip = clipboardManager.primaryClip
                ?: return error("Portapapeles vacío.", "CLIPBOARD_EMPTY")

            if (clip.itemCount <= 0) {
                return error("Portapapeles vacío.", "CLIPBOARD_EMPTY")
            }

            val item = clip.getItemAt(0)
            val uri = item.uri
            if (uri != null) {
                val imageDataUrl = readImageDataUrlFromUri(uri)
                if (imageDataUrl != null) {
                    return JSONObject()
                        .put("success", true)
                        .put("source", "uri")
                        .put("imageDataUrl", imageDataUrl)
                        .toString()
                }
            }

            val html = item.htmlText?.takeIf { it.isNotBlank() }
            val text = item.coerceToText(appContext)?.toString()?.trim()?.takeIf { it.isNotBlank() }

            if (html != null || text != null) {
                return JSONObject()
                    .put("success", true)
                    .put("source", "text")
                    .put("html", html)
                    .put("text", text)
                    .toString()
            }

            val description = clip.description
            if (description != null && hasImageMimeType(description)) {
                return error("La imagen del portapapeles no se pudo leer desde Android.", "CLIPBOARD_IMAGE_UNREADABLE")
            }

            error("Contenido del portapapeles no soportado.", "CLIPBOARD_UNSUPPORTED")
        } catch (e: SecurityException) {
            error(e.message ?: "Android bloqueó el acceso al portapapeles.", "CLIPBOARD_SECURITY")
        } catch (e: Exception) {
            error(e.message ?: "Error leyendo portapapeles.", "CLIPBOARD_ERROR")
        }
    }

    @JavascriptInterface
    fun closeBridge(): String {
        manager.close()
        return JSONObject().put("status", "success").toString()
    }

    @JavascriptInterface
    fun validateDgiiRnc(payloadJson: String?): String {
        val payload = try {
            JSONObject(payloadJson ?: "{}")
        } catch (_: Exception) {
            JSONObject()
        }

        val sanitizedRnc = payload.optString("rnc", "")
            .replace(Regex("[^0-9]"), "")

        if (sanitizedRnc.length !in 9..11) {
            Log.w(DGII_LOG_TAG, "Rejected invalid RNC payload: $sanitizedRnc")
            return JSONObject()
                .put("rnc", sanitizedRnc)
                .put("name", "")
                .put("status", "NO_REGISTRADO")
                .put("error", "RNC inválido: debe contener entre 9 y 11 dígitos")
                .toString()
        }

        Log.d(DGII_LOG_TAG, "Starting native DGII lookup for RNC $sanitizedRnc")
        return try {
            val result = performNativeDgiiLookup(sanitizedRnc)
            Log.d(
                DGII_LOG_TAG,
                "Native DGII result for $sanitizedRnc => ${result.optString("status")} / ${result.optString("name")}"
            )
            result.toString()
        } catch (e: Exception) {
            Log.e(DGII_LOG_TAG, "Native DGII lookup failed for $sanitizedRnc", e)
            JSONObject()
                .put("rnc", sanitizedRnc)
                .put("name", "")
                .put("status", "NO_REGISTRADO")
                .put("error", e.message ?: "Error consultando DGII")
                .toString()
        }
    }

    private fun hasImageMimeType(description: ClipDescription): Boolean {
        for (index in 0 until description.mimeTypeCount) {
            val mime = description.getMimeType(index) ?: continue
            if (mime.startsWith("image/")) return true
        }
        return false
    }

    private fun routeEscPosPrint(
        rawBytes: ByteArray,
        connection: String,
        printerAddress: String?,
        printerName: String?,
        printerId: String?
    ): ClicPOSBluetoothPrinterManager.PrintResult {
        return when (connection.uppercase()) {
            "BLUETOOTH" -> manager.printEscPos(rawBytes, printerAddress, printerName, printerId)
            "USB" -> usbPrintEscPos(rawBytes, printerAddress, printerName)
            "NETWORK" -> networkPrintEscPos(rawBytes, printerAddress)
            else -> ClicPOSBluetoothPrinterManager.PrintResult(
                status = "error",
                success = false,
                printed = false,
                message = "Modo de impresión no soportado: $connection",
                errorCode = "UNSUPPORTED_CONNECTION"
            )
        }
    }

    private fun printCopies(
        copies: Int,
        printCopy: () -> ClicPOSBluetoothPrinterManager.PrintResult
    ): ClicPOSBluetoothPrinterManager.PrintResult {
        var lastResult: ClicPOSBluetoothPrinterManager.PrintResult? = null
        repeat(copies.coerceIn(1, 10)) {
            val result = printCopy()
            lastResult = result
            if (!result.success) return result
        }

        val completed = lastResult ?: return ClicPOSBluetoothPrinterManager.PrintResult(
            status = "error",
            success = false,
            printed = false,
            message = "No se procesaron copias.",
            errorCode = "COPIES_INVALID"
        )
        return completed.copy(
            message = if (copies > 1) "$copies copias procesadas correctamente." else completed.message
        )
    }

    private fun repeatNetworkPayload(rawBytes: ByteArray, copies: Int): ByteArray {
        val safeCopies = copies.coerceIn(1, 10)
        if (safeCopies == 1) return rawBytes

        val combined = ByteArray(rawBytes.size * safeCopies)
        repeat(safeCopies) { copyIndex ->
            rawBytes.copyInto(combined, destinationOffset = copyIndex * rawBytes.size)
        }
        return combined
    }

    private fun ClicPOSBluetoothPrinterManager.PrintResult.withCopyMessage(copies: Int): ClicPOSBluetoothPrinterManager.PrintResult {
        if (!success || copies <= 1) return this
        return copy(message = "$copies copias enviadas en un solo trabajo de red.")
    }

    private fun htmlToPlainTextBytes(html: String): ByteArray {
        val text = html
            .replace(Regex("<script[\\s\\S]*?</script>", RegexOption.IGNORE_CASE), "")
            .replace(Regex("<style[\\s\\S]*?</style>", RegexOption.IGNORE_CASE), "")
            .replace(Regex("<br\\s*/?>", RegexOption.IGNORE_CASE), "\n")
            .replace(Regex("</p>", RegexOption.IGNORE_CASE), "\n")
            .replace(Regex("<[^>]+>"), " ")
            .replace("&nbsp;", " ")
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace(Regex("[ \t]+"), " ")
            .replace(Regex("\\n{3,}"), "\n\n")
            .trim()

        return (text + "\n\n").toByteArray(Charsets.UTF_8)
    }

    private fun usbPrintEscPos(rawBytes: ByteArray, printerAddress: String?, printerName: String?): ClicPOSBluetoothPrinterManager.PrintResult {
        if (rawBytes.isEmpty()) {
            return ClicPOSBluetoothPrinterManager.PrintResult(
                status = "error",
                success = false,
                printed = false,
                message = "USB payload is empty.",
                errorCode = "PAYLOAD_INVALID"
            )
        }

        return try {
            val device = findUsbDevice(printerAddress, printerName)
                ?: throw IllegalStateException("No se detectó una impresora USB conectada.")
            val transfer = openUsbTransfer(device)
            try {
                writeUsbBytes(transfer.connection, transfer.endpoint, rawBytes)
                ClicPOSBluetoothPrinterManager.PrintResult(
                    status = "success",
                    success = true,
                    printed = true,
                    message = "Ticket enviado por USB correctamente."
                )
            } finally {
                closeUsbTransfer(transfer)
            }
        } catch (e: Exception) {
            ClicPOSBluetoothPrinterManager.PrintResult(
                status = "error",
                success = false,
                printed = false,
                message = e.message ?: "No se pudo imprimir por USB.",
                errorCode = "USB_PRINT_ERROR"
            )
        }
    }

    private fun networkPrintEscPos(rawBytes: ByteArray, printerAddress: String?): ClicPOSBluetoothPrinterManager.PrintResult {
        if (rawBytes.isEmpty()) {
            return ClicPOSBluetoothPrinterManager.PrintResult(
                status = "error",
                success = false,
                printed = false,
                message = "Network payload is empty.",
                errorCode = "PAYLOAD_INVALID"
            )
        }

        return try {
            val endpoint = parseNetworkEndpoint(printerAddress)
                ?: throw IllegalStateException("Debe indicar una IP válida para la impresora de red.")

            Socket().use { socket ->
                socket.connect(InetSocketAddress(endpoint.first, endpoint.second), 2000)
                socket.getOutputStream().use { out ->
                    out.write(rawBytes)
                    out.flush()
                }
            }

            ClicPOSBluetoothPrinterManager.PrintResult(
                status = "success",
                success = true,
                printed = true,
                message = "Ticket enviado por red correctamente."
            )
        } catch (e: Exception) {
            ClicPOSBluetoothPrinterManager.PrintResult(
                status = "error",
                success = false,
                printed = false,
                message = e.message ?: "No se pudo imprimir por red.",
                errorCode = "NETWORK_PRINT_ERROR"
            )
        }
    }

    private fun readImageDataUrlFromUri(uri: Uri): String? {
        val contentResolver = appContext.contentResolver
        val mimeType = contentResolver.getType(uri) ?: return null
        if (!mimeType.startsWith("image/")) return null

        contentResolver.openInputStream(uri)?.use { input ->
            val bytes = input.readBytes()
            if (bytes.isEmpty()) return null
            val encoded = Base64.encodeToString(bytes, Base64.NO_WRAP)
            return "data:$mimeType;base64,$encoded"
        }

        return null
    }

    private fun toJson(result: ClicPOSBluetoothPrinterManager.PrintResult): String {
        return JSONObject()
            .put("status", result.status)
            .put("success", result.success)
            .put("printed", result.printed)
            .put("message", result.message)
            .put("errorCode", result.errorCode)
            .toString()
    }

    private fun error(message: String, code: String): String {
        return JSONObject()
            .put("status", "error")
            .put("success", false)
            .put("printed", false)
            .put("message", message)
            .put("errorCode", code)
            .toString()
    }

    private fun performNativeDgiiLookup(rnc: String): JSONObject {
        val userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        Log.d(DGII_LOG_TAG, "GET DGII page for $rnc")

        val initialConnection = (URL(dgiiUrl).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            setRequestProperty("User-Agent", userAgent)
            setRequestProperty("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
            setRequestProperty("Accept-Language", "es-DO,es;q=0.9,en;q=0.8")
            setRequestProperty("Connection", "keep-alive")
            connectTimeout = 10000
            readTimeout = 10000
            instanceFollowRedirects = true
        }

        val initialHtml = initialConnection.inputStream.use { it.bufferedReader().readText() }
        Log.d(DGII_LOG_TAG, "DGII initial page loaded for $rnc with ${initialHtml.length} chars")
        val cookies = initialConnection.headerFields
            .entries
            .firstOrNull { (key, _) -> key?.equals("Set-Cookie", ignoreCase = true) == true }
            ?.value
            ?.joinToString("; ") { value -> value.substringBefore(';') }
            .orEmpty()
        initialConnection.disconnect()

        val viewState = extractInputValue(initialHtml, "__VIEWSTATE")
            ?: throw IllegalStateException("No se pudo extraer __VIEWSTATE desde DGII")
        val eventValidation = extractInputValue(initialHtml, "__EVENTVALIDATION")
            ?: throw IllegalStateException("No se pudo extraer __EVENTVALIDATION desde DGII")
        val viewStateGenerator = extractInputValue(initialHtml, "__VIEWSTATEGENERATOR").orEmpty()

        Log.d(DGII_LOG_TAG, "POST DGII lookup for $rnc")
        val formData = buildString {
            appendFormField("__VIEWSTATE", viewState)
            appendFormField("__VIEWSTATEGENERATOR", viewStateGenerator)
            appendFormField("__EVENTVALIDATION", eventValidation)
            appendFormField("ctl00\$cphMain\$txtRNCCedula", rnc)
            appendFormField("ctl00\$cphMain\$btnBuscarPorRNC", "BUSCAR")
        }

        val searchConnection = (URL(dgiiUrl).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
            setRequestProperty("User-Agent", userAgent)
            setRequestProperty("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
            setRequestProperty("Accept-Language", "es-DO,es;q=0.9,en;q=0.8")
            setRequestProperty("Referer", dgiiUrl)
            setRequestProperty("Origin", "https://dgii.gov.do")
            setRequestProperty("Connection", "keep-alive")
            if (cookies.isNotBlank()) {
                setRequestProperty("Cookie", cookies)
            }
            connectTimeout = 10000
            readTimeout = 10000
            instanceFollowRedirects = true
        }

        searchConnection.outputStream.use { output ->
            OutputStreamWriter(output, Charsets.UTF_8).use { writer ->
                writer.write(formData)
                writer.flush()
            }
        }

        val responseHtml = runCatching {
            searchConnection.inputStream.use { it.bufferedReader().readText() }
        }.getOrElse {
            searchConnection.errorStream?.use { stream ->
                return JSONObject()
                    .put("rnc", rnc)
                    .put("name", "")
                    .put("status", "NO_REGISTRADO")
                    .put("error", stream.bufferedReader().readText().ifBlank { "DGII respondió con error HTTP ${searchConnection.responseCode}" })
            }
            throw IllegalStateException("DGII respondió con error HTTP ${searchConnection.responseCode}")
        }

        searchConnection.disconnect()
        Log.d(DGII_LOG_TAG, "DGII response HTML received for $rnc with ${responseHtml.length} chars")
        return parseDgiiHtml(responseHtml, rnc)
    }

    private fun StringBuilder.appendFormField(key: String, value: String) {
        if (isNotEmpty()) append('&')
        append(URLEncoder.encode(key, "UTF-8"))
        append('=')
        append(URLEncoder.encode(value, "UTF-8"))
    }

    private fun extractInputValue(html: String, inputId: String): String? {
        val regex = Regex("""id="$inputId"\s+value="([^"]*)"""")
        return regex.find(html)?.groupValues?.getOrNull(1)
    }

    private fun parseDgiiHtml(html: String, rnc: String): JSONObject {
        if (
            html.contains("No existe", ignoreCase = true) ||
            html.contains("no se encuentra", ignoreCase = true) ||
            html.contains("no encontrado", ignoreCase = true)
        ) {
            Log.w(DGII_LOG_TAG, "DGII reported NO_REGISTRADO for $rnc by content match")
            return JSONObject()
                .put("rnc", rnc)
                .put("name", "")
                .put("status", "NO_REGISTRADO")
        }

        val result = JSONObject()
            .put("rnc", rnc)
            .put("name", "")
            .put("status", "NO_REGISTRADO")

        val name = extractTableValue(html, "(?:Nombre|Raz[óo]n\\s+Social)")
        val commercialName = extractTableValue(html, "Nombre\\s+Comercial")
        val statusText = extractTableValue(html, "Estado")?.uppercase()
        val regimeType = extractTableValue(html, "(?:R[ée]gimen|Tipo)")
        val economicActivity = extractTableValue(html, "Actividad\\s+Econ[óo]mica")

        if (!name.isNullOrBlank()) {
            result.put("name", name)
        }

        if (!commercialName.isNullOrBlank()) {
            result.put("commercialName", commercialName)
        }

        if (!regimeType.isNullOrBlank()) {
            result.put("regimeType", regimeType)
        }

        if (!economicActivity.isNullOrBlank()) {
            result.put("economicActivity", economicActivity)
        }

        when {
            statusText?.contains("ACTIVO") == true -> result.put("status", "ACTIVO")
            statusText?.contains("INACTIVO") == true || statusText?.contains("SUSPENDIDO") == true -> result.put("status", "INACTIVO")
        }

        if (result.optString("name").isBlank()) {
            result.put("status", "NO_REGISTRADO")
        }

        Log.d(
            DGII_LOG_TAG,
            "Parsed DGII for $rnc => status=${result.optString("status")} name=${result.optString("name")}"
        )

        return result
    }

    private fun extractTableValue(html: String, labelPattern: String): String? {
        val regex = Regex(
            "<td[^>]*>\\s*$labelPattern[^<]*</td>\\s*<td[^>]*>([^<]+)</td>",
            setOf(RegexOption.IGNORE_CASE)
        )
        return regex.find(html)
            ?.groupValues
            ?.getOrNull(1)
            ?.let(::cleanDgiiText)
    }

    private fun cleanDgiiText(text: String): String {
        return text
            .replace("&nbsp;", " ")
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace(Regex("&#\\d+;"), "")
            .trim()
            .replace(Regex("\\s+"), " ")
    }

    private fun getLocalIpv4Addresses(): List<String> {
        return try {
            val interfaces = NetworkInterface.getNetworkInterfaces()
            val interfaceEntries = if (interfaces != null) Collections.list(interfaces) else emptyList()
            val addressEntries = interfaceEntries
                .filter { iface ->
                    runCatching { iface.isUp && !iface.isLoopback && !iface.isVirtual }.getOrDefault(false)
                }
                .flatMap { iface ->
                    Collections.list(iface.inetAddresses)
                        .mapNotNull { address ->
                            val ipv4 = address as? Inet4Address ?: return@mapNotNull null
                            val hostAddress = ipv4.hostAddress ?: return@mapNotNull null
                            if (ipv4.isLoopbackAddress || hostAddress.startsWith("127.")) return@mapNotNull null
                            if (!ipv4.isSiteLocalAddress) return@mapNotNull null
                            iface.name to hostAddress
                        }
                }

            addressEntries
                .sortedWith(
                    compareBy<Pair<String, String>> { entry ->
                        when {
                            entry.first.startsWith("wlan") -> 0
                            entry.first.startsWith("eth") -> 1
                            entry.first.startsWith("en") -> 2
                            else -> 3
                        }
                    }.thenBy { it.first }.thenBy { it.second }
                )
                .map { it.second }
                .distinct()
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun discoverUsbFingerprintReaders(): List<JSONObject> {
        val usbManager = appContext.getSystemService(Context.USB_SERVICE) as? UsbManager ?: return emptyList()
        return usbManager.deviceList.values
            .filter { !isUsbPrinterCandidate(it) && isLikelyFingerprintReader(it) }
            .map { device ->
                JSONObject()
                    .put("id", usbDeviceId(device))
                    .put("name", usbFingerprintDisplayName(device))
                    .put("connection", "USB")
                    .put("address", usbDeviceAddress(device))
                    .put("vendorId", device.vendorId)
                    .put("productId", device.productId)
                    .put("status", "CONNECTED")
            }
            .sortedBy { it.optString("name", "USB") }
    }

    private fun usbFingerprintDisplayName(device: UsbDevice): String {
        val manufacturer = device.manufacturerName?.takeIf { it.isNotBlank() }
        val product = device.productName?.takeIf { it.isNotBlank() }
        return when {
            manufacturer != null && product != null -> "$manufacturer $product"
            product != null -> product
            manufacturer != null -> manufacturer
            else -> "Lector USB ${device.deviceId}"
        }
    }

    private fun isLikelyFingerprintReader(device: UsbDevice): Boolean {
        if (device.deviceClass == UsbConstants.USB_CLASS_HUB) {
            return false
        }
        val label = "${device.manufacturerName} ${device.productName}".lowercase()
        if (listOf("keyboard", "teclado", "mouse", "ratón", "hub", "camera", "webcam", "audio", "headset")
                .any { label.contains(it) }) {
            return false
        }
        val keywordHit = listOf(
            "finger", "biomet", "bio-id", "secugen", "digital persona", "digitalpersona",
            "zkteco", "nitgen", "futronic", "suprema", "crossmatch", "mantra", "morpho",
            "realscan", "u.are.u", "signotec", "lumidigm", "integrated", "touchchip"
        ).any { label.contains(it) }

        if (keywordHit) return true

        var hidLike = false
        var vendorLike = false
        for (index in 0 until device.interfaceCount) {
            val intf = device.getInterface(index)
            when (intf.interfaceClass) {
                UsbConstants.USB_CLASS_HID -> hidLike = true
                UsbConstants.USB_CLASS_VENDOR_SPEC -> vendorLike = true
            }
        }
        if (device.deviceClass == UsbConstants.USB_CLASS_HID) {
            hidLike = true
        }
        return hidLike || vendorLike
    }

    private fun findUsbFingerprintDeviceForTest(address: String?, id: String?): UsbDevice? {
        val usbManager = appContext.getSystemService(Context.USB_SERVICE) as? UsbManager ?: return null
        val wantId = id?.trim()?.takeIf { it.isNotBlank() }
        val wantAddr = address?.trim()?.takeIf { it.isNotBlank() }

        val fingerprintCandidates = usbManager.deviceList.values
            .filter { !isUsbPrinterCandidate(it) && isLikelyFingerprintReader(it) }
            .toList()

        fun matchDevice(d: UsbDevice): Boolean {
            if (wantId != null) {
                if (usbDeviceId(d) == wantId) return true
                if (d.deviceName == wantId) return true
            }
            if (wantAddr != null) {
                if (usbDeviceAddress(d).equals(wantAddr, ignoreCase = true)) return true
                if (usbDeviceId(d).equals(wantAddr, ignoreCase = true)) return true
            }
            return false
        }

        fingerprintCandidates.firstOrNull { matchDevice(it) }?.let { return it }

        // Coincidencia laxa con cualquier USB (por si el usuario pegó la ruta manualmente)
        for (d in usbManager.deviceList.values) {
            if (wantId != null && (usbDeviceId(d) == wantId || d.deviceName == wantId)) return d
            if (wantAddr != null && usbDeviceAddress(d).equals(wantAddr, ignoreCase = true)) return d
        }
        return null
    }

    private fun discoverUsbPrinters(): List<JSONObject> {
        val usbManager = appContext.getSystemService(Context.USB_SERVICE) as? UsbManager ?: return emptyList()
        return usbManager.deviceList.values
            .filter(::isUsbPrinterCandidate)
            .map { device ->
                JSONObject()
                    .put("id", usbDeviceId(device))
                    .put("name", usbDeviceName(device))
                    .put("connection", "USB")
                    .put("address", usbDeviceAddress(device))
                    .put("status", "CONNECTED")
                    .put("type", "TICKET")
            }
            .sortedBy { it.optString("name", "USB Printer") }
    }

    private fun resolveUsbPrinter(address: String?, fallbackName: String?): JSONObject {
        val device = findUsbDevice(address, fallbackName)
            ?: throw IllegalStateException("No se detectó una impresora USB conectada.")

        return JSONObject()
            .put("id", usbDeviceId(device))
            .put("name", usbDeviceName(device))
            .put("connection", "USB")
            .put("address", usbDeviceAddress(device))
            .put("status", "CONNECTED")
            .put("type", "TICKET")
    }

    private fun findUsbDevice(address: String?, fallbackName: String?): UsbDevice? {
        val usbManager = appContext.getSystemService(Context.USB_SERVICE) as? UsbManager ?: return null
        val devices = usbManager.deviceList.values
            .filter(::isUsbPrinterCandidate)
            .toList()
        if (devices.isEmpty()) return null

        val normalizedAddress = address?.trim()?.lowercase()
        val normalizedName = fallbackName?.trim()?.lowercase()

        return devices.firstOrNull { device ->
            listOf(
                usbDeviceId(device),
                usbDeviceAddress(device),
                device.deviceName,
                device.productName ?: "",
                device.manufacturerName ?: ""
            )
                .filter { it.isNotBlank() }
                .any { candidate -> normalizedAddress != null && candidate.lowercase() == normalizedAddress }
        } ?: devices.firstOrNull { device ->
            normalizedName != null && usbDeviceName(device).lowercase() == normalizedName
        } ?: devices.firstOrNull()
    }

    private fun isUsbPrinterCandidate(device: UsbDevice): Boolean {
        if (device.deviceClass == UsbConstants.USB_CLASS_PRINTER) {
            return true
        }

        for (index in 0 until device.interfaceCount) {
            val usbInterface = device.getInterface(index)
            if (isPrintableUsbInterface(usbInterface)) {
                return true
            }
        }

        return false
    }

    private fun isPrintableUsbInterface(usbInterface: UsbInterface): Boolean {
        if (usbInterface.interfaceClass == UsbConstants.USB_CLASS_PRINTER) {
            return true
        }

        if (usbInterface.interfaceClass == UsbConstants.USB_CLASS_HID) {
            return false
        }

        val candidateClass = when (usbInterface.interfaceClass) {
            UsbConstants.USB_CLASS_PER_INTERFACE,
            UsbConstants.USB_CLASS_VENDOR_SPEC,
            UsbConstants.USB_CLASS_COMM,
            UsbConstants.USB_CLASS_CDC_DATA,
            UsbConstants.USB_CLASS_MISC -> true
            else -> false
        }

        if (!candidateClass) {
            return false
        }

        return findUsbOutEndpoint(usbInterface) != null
    }

    private fun usbDeviceId(device: UsbDevice): String =
        "usb:${device.vendorId}:${device.productId}:${device.deviceId}"

    private fun usbDeviceAddress(device: UsbDevice): String =
        device.deviceName ?: usbDeviceId(device)

    private fun usbDeviceName(device: UsbDevice): String {
        val manufacturer = device.manufacturerName?.takeIf { it.isNotBlank() }
        val product = device.productName?.takeIf { it.isNotBlank() }
        return when {
            manufacturer != null && product != null -> "$manufacturer $product"
            product != null -> product
            manufacturer != null -> manufacturer
            else -> "USB Printer ${device.deviceId}"
        }
    }

    private fun parseNetworkEndpoint(rawAddress: String?): Pair<String, Int>? {
        val value = rawAddress?.trim()?.takeIf { it.isNotBlank() } ?: return null
        val hostPort = value.removePrefix("tcp://").removePrefix("http://").removePrefix("https://")
        val parts = hostPort.split(':')
        val host = parts.firstOrNull()?.trim()?.takeIf { it.isNotBlank() } ?: return null
        val port = parts.getOrNull(1)?.toIntOrNull() ?: 9100
        return host to port
    }

    private fun testTcpEndpoint(host: String, port: Int): Boolean {
        return try {
            Socket().use { socket ->
                socket.connect(InetSocketAddress(host, port), 1500)
            }
            true
        } catch (_: Exception) {
            false
        }
    }

    private data class UsbTransfer(
        val connection: UsbDeviceConnection,
        val usbInterface: UsbInterface,
        val endpoint: UsbEndpoint
    )

    private fun openUsbTransfer(device: UsbDevice): UsbTransfer {
        val usbManager = appContext.getSystemService(Context.USB_SERVICE) as? UsbManager
            ?: throw IllegalStateException("USB host no disponible en este dispositivo.")

        if (!requestUsbPermission(usbManager, device)) {
            throw IllegalStateException("Android no concedió permiso para acceder a la impresora USB.")
        }

        val connection = usbManager.openDevice(device)
            ?: throw IllegalStateException("No se pudo abrir el puerto USB para la impresora.")

        for (index in 0 until device.interfaceCount) {
            val usbInterface = device.getInterface(index)
            if (!isPrintableUsbInterface(usbInterface)) continue
            if (!connection.claimInterface(usbInterface, true)) continue

            val endpoint = findUsbOutEndpoint(usbInterface)
            if (endpoint != null) {
                return UsbTransfer(connection, usbInterface, endpoint)
            }

            connection.releaseInterface(usbInterface)
        }

        connection.close()
        throw IllegalStateException("No se encontró un endpoint de salida para la impresora USB.")
    }

    private fun closeUsbTransfer(transfer: UsbTransfer) {
        runCatching { transfer.connection.releaseInterface(transfer.usbInterface) }
        runCatching { transfer.connection.close() }
    }

    private fun findUsbOutEndpoint(usbInterface: UsbInterface): UsbEndpoint? {
        for (index in 0 until usbInterface.endpointCount) {
            val endpoint = usbInterface.getEndpoint(index)
            if (endpoint.direction == UsbConstants.USB_DIR_OUT) {
                return endpoint
            }
        }
        return null
    }

    private fun writeUsbBytes(connection: UsbDeviceConnection, endpoint: UsbEndpoint, bytes: ByteArray) {
        var offset = 0
        while (offset < bytes.size) {
            val chunkSize = minOf(4096, bytes.size - offset)
            val chunk = bytes.copyOfRange(offset, offset + chunkSize)
            val transferred = connection.bulkTransfer(endpoint, chunk, chunk.size, 4000)
            if (transferred <= 0) {
                throw IllegalStateException("La impresora USB no aceptó datos en el puerto seleccionado.")
            }
            offset += transferred
        }
    }

    private fun requestUsbPermission(usbManager: UsbManager, device: UsbDevice): Boolean {
        if (usbManager.hasPermission(device)) return true

        val latch = CountDownLatch(1)
        var granted = false
        var receiverRegistered = false
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                if (intent?.action != usbPermissionAction) return
                val grantedDevice = intent.getParcelableExtra<UsbDevice>(UsbManager.EXTRA_DEVICE)
                if (grantedDevice?.deviceId == device.deviceId) {
                    granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
                    latch.countDown()
                }
            }
        }

        try {
            val filter = IntentFilter(usbPermissionAction)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                appContext.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                @Suppress("DEPRECATION")
                appContext.registerReceiver(receiver, filter)
            }
            receiverRegistered = true

            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            } else {
                PendingIntent.FLAG_UPDATE_CURRENT
            }

            val intent = Intent(usbPermissionAction).setPackage(appContext.packageName)
            val pendingIntent = PendingIntent.getBroadcast(appContext, device.deviceId, intent, flags)
            usbManager.requestPermission(device, pendingIntent)
            latch.await(5, TimeUnit.SECONDS)
        } catch (_: Exception) {
            granted = false
        } finally {
            if (receiverRegistered) {
                runCatching { appContext.unregisterReceiver(receiver) }
            }
        }

        return granted || usbManager.hasPermission(device)
    }
}
