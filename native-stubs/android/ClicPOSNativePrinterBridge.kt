package com.clicpos.nativeprinter

import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.Collections
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
    private val appContext = context.applicationContext
    private val clipboardManager = appContext.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager

    private val manager = ClicPOSBluetoothPrinterManager(appContext)

    @JavascriptInterface
    fun printEscPos(payloadJson: String?): String {
        return try {
            val payload = JSONObject(payloadJson ?: "{}")
            val dataBase64 = payload.optString("dataBase64", "")
            if (dataBase64.isBlank()) {
                return error("Missing dataBase64", "PAYLOAD_INVALID")
            }

            val rawBytes = Base64.decode(dataBase64, Base64.DEFAULT)
            val result = manager.printEscPos(
                rawBytes = rawBytes,
                printerAddress = payload.optString("printerAddress", null),
                printerName = payload.optString("printerName", null),
                printerId = payload.optString("printerId", null)
            )
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

            val result = manager.printHtmlAsText(
                html = html,
                printerAddress = payload.optString("printerAddress", null),
                printerName = payload.optString("printerName", null),
                printerId = payload.optString("printerId", null)
            )
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

            if (connection != "BLUETOOTH") {
                return JSONObject().put("devices", JSONArray()).toString()
            }

            val devices = manager.discoverBondedPrinters()
            JSONObject()
                .put("devices", JSONArray().apply {
                    devices.forEach { device ->
                        put(JSONObject()
                            .put("id", device.id)
                            .put("name", device.name)
                            .put("connection", device.connection)
                            .put("address", device.address)
                            .put("status", device.status)
                            .put("type", device.type)
                        )
                    }
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
    fun pairPrinter(payloadJson: String?): String {
        return try {
            val payload = JSONObject(payloadJson ?: "{}")
            val connection = payload.optString("connection", "BLUETOOTH").uppercase()
            if (connection != "BLUETOOTH") {
                return error("Only BLUETOOTH pairing is implemented in this bridge.", "UNSUPPORTED_CONNECTION")
            }

            val address = payload.optString("address", payload.optString("id", null))
            val name = payload.optString("name", null)
            val paired = manager.pairPrinter(address = address, fallbackName = name)

            JSONObject()
                .put("printer", JSONObject()
                    .put("id", paired.id)
                    .put("name", paired.name)
                    .put("connection", paired.connection)
                    .put("address", paired.address)
                    .put("status", paired.status)
                    .put("type", paired.type)
                )
                .toString()
        } catch (e: Exception) {
            error(e.message ?: "PAIR_ERROR", "PAIR_ERROR")
        }
    }

    @JavascriptInterface
    fun connectPrinter(payloadJson: String?): String = pairPrinter(payloadJson)

    @JavascriptInterface
    fun bindPrinter(payloadJson: String?): String = pairPrinter(payloadJson)

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

    private fun hasImageMimeType(description: ClipDescription): Boolean {
        for (index in 0 until description.mimeTypeCount) {
            val mime = description.getMimeType(index) ?: continue
            if (mime.startsWith("image/")) return true
        }
        return false
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

    companion object {
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
                    getDeviceProfile: function () { return Promise.resolve(parseResult(window.AndroidPrinter.getDeviceProfile())); },
                    getDeviceInfo: function () { return Promise.resolve(parseResult(window.AndroidPrinter.getDeviceInfo())); }
                  };
                })();
            """.trimIndent()

            webView.post {
                webView.evaluateJavascript(script, null)
            }
        }
    }
}
