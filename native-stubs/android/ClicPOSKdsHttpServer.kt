package com.clicpos.nativeprinter

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

object ClicPOSKdsHttpServer {
    private const val DEFAULT_PORT = 8001
    private val running = AtomicBoolean(false)
    private val orders = ConcurrentHashMap<String, JSONObject>()
    private val executor = Executors.newCachedThreadPool()
    private var serverSocket: ServerSocket? = null
    private var activePort = DEFAULT_PORT

    fun start(context: Context, requestedPort: Int = DEFAULT_PORT): JSONObject {
        val port = requestedPort.takeIf { it in 1..65535 } ?: DEFAULT_PORT
        activePort = port

        if (running.get()) {
            return status(context)
        }

        return try {
            val socket = ServerSocket(port)
            socket.reuseAddress = true
            serverSocket = socket
            running.set(true)

            executor.execute {
                while (running.get()) {
                    try {
                        val client = socket.accept()
                        executor.execute { handleClient(client) }
                    } catch (_: Exception) {
                        if (running.get()) {
                            running.set(false)
                        }
                    }
                }
            }

            status(context)
        } catch (error: Exception) {
            running.set(false)
            JSONObject()
                .put("status", "error")
                .put("success", false)
                .put("running", false)
                .put("port", port)
                .put("message", error.message ?: "No se pudo iniciar servidor KDS")
        }
    }

    fun stop(): JSONObject {
        running.set(false)
        runCatching { serverSocket?.close() }
        serverSocket = null
        return JSONObject()
            .put("status", "stopped")
            .put("success", true)
            .put("running", false)
            .put("port", activePort)
    }

    fun status(context: Context): JSONObject {
        val ips = getLocalIpv4Addresses()
        val localIp = ips.firstOrNull()
        return JSONObject()
            .put("status", if (running.get()) "running" else "stopped")
            .put("success", running.get())
            .put("running", running.get())
            .put("port", activePort)
            .put("localIp", localIp)
            .put("localIps", JSONArray(ips))
            .put("url", if (localIp != null) "http://$localIp:$activePort" else JSONObject.NULL)
            .put("ordersCount", orders.size)
            .put("packageName", context.packageName)
    }

    private fun handleClient(socket: Socket) {
        socket.use { client ->
            try {
                client.soTimeout = 5000
                val input = client.getInputStream()
                val requestLine = readAsciiLine(input)
                if (requestLine.isBlank()) return

                val parts = requestLine.split(" ")
                val method = parts.getOrNull(0)?.uppercase() ?: "GET"
                val rawPath = parts.getOrNull(1) ?: "/"
                val path = rawPath.substringBefore("?")
                val headers = mutableMapOf<String, String>()
                while (true) {
                    val line = readAsciiLine(input)
                    if (line.isBlank()) break
                    val separator = line.indexOf(':')
                    if (separator > 0) {
                        headers[line.substring(0, separator).trim().lowercase()] = line.substring(separator + 1).trim()
                    }
                }

                val contentLength = headers["content-length"]?.toIntOrNull() ?: 0
                val body = if (contentLength > 0) {
                    val buffer = ByteArray(contentLength)
                    var offset = 0
                    while (offset < contentLength) {
                        val read = input.read(buffer, offset, contentLength - offset)
                        if (read <= 0) break
                        offset += read
                    }
                    String(buffer, 0, offset, StandardCharsets.UTF_8)
                } else {
                    ""
                }

                if (method == "OPTIONS") {
                    writeResponse(client, 204, "")
                    return
                }

                val response = route(method, path, body)
                writeResponse(client, response.first, response.second.toString())
            } catch (error: Exception) {
                writeResponse(
                    client,
                    500,
                    JSONObject()
                        .put("status", "error")
                        .put("message", error.message ?: "KDS server error")
                        .toString()
                )
            }
        }
    }

    private fun route(method: String, path: String, body: String): Pair<Int, Any> {
        if (method == "GET" && path == "/api/cocina/ordenes-activas") {
            return 200 to activeOrders()
        }

        if ((method == "POST" || method == "PUT") && path.startsWith("/api/ordenes/")) {
            val segments = path.trim('/').split('/')
            val orderIdSegment = if (segments.getOrNull(2) == "enviar-comanda") {
                segments.getOrNull(3)
            } else {
                segments.getOrNull(2)
            }
            val orderId = orderIdSegment?.let { URLDecoder.decode(it, "UTF-8") }.orEmpty()
            if (orderId.isBlank()) {
                return 400 to JSONObject().put("status", "error").put("message", "orderId requerido")
            }

            val payload = parseObject(body)
            upsertOrder(orderId, payload)
            return 200 to JSONObject()
                .put("status", "success")
                .put("success", true)
                .put("orderId", orderId)
                .put("mode", if (path.contains("/enviar-comanda/")) "direct_payload" else "order_update")
        }

        if (method == "POST" && path == "/api/cocina/cambiar-estado") {
            val payload = parseObject(body)
            updateStatus(payload.optString("item_id", ""), payload.optString("orden_id", ""), payload.optString("nuevo_estado", "PENDIENTE"))
            return 200 to JSONObject().put("status", "success").put("success", true)
        }

        return 404 to JSONObject().put("status", "error").put("message", "Not found")
    }

    private fun upsertOrder(orderId: String, payload: JSONObject) {
        val existing = orders[orderId] ?: JSONObject()
        val items = payload.optJSONArray("items") ?: existing.optJSONArray("items") ?: JSONArray()
        val normalizedItems = JSONArray()
        for (index in 0 until items.length()) {
            val item = items.optJSONObject(index) ?: continue
            normalizedItems.put(normalizeItem(orderId, item, index))
        }

        val area = payload.optJSONObject("area")
        val table = payload.optJSONObject("table")
        val kdsTiming = payload.optJSONObject("kdsTiming")
        val now = payload.optString("date").ifBlank { existing.optString("date").ifBlank { isoNow() } }
        val next = JSONObject(existing.toString())
            .put("id", orderId)
            .put("displayId", payload.optString("displayId").ifBlank { existing.optString("displayId").ifBlank { orderId } })
            .put("date", now)
            .put("userName", payload.optString("userName").ifBlank { existing.optString("userName") })
            .put("customerId", payload.optString("customerId").ifBlank { existing.optString("customerId") })
            .put("customerName", payload.optString("customerName").ifBlank { existing.optString("customerName").ifBlank { "Cliente General" } })
            .put("table", table ?: existing.optJSONObject("table") ?: JSONObject.NULL)
            .put("area", area ?: existing.optJSONObject("area") ?: JSONObject.NULL)
            .put("kdsTiming", kdsTiming ?: existing.optJSONObject("kdsTiming") ?: JSONObject.NULL)
            .put("items", mergeItems(existing.optJSONArray("items"), normalizedItems))

        orders[orderId] = next
    }

    private fun normalizeItem(orderId: String, item: JSONObject, index: Int): JSONObject {
        val rawId = item.optString("id").ifBlank { item.optString("cartId").ifBlank { "item-$index" } }
        val id = if (rawId.startsWith(orderId)) rawId else "${orderId}_${rawId}_$index"
        val modifiers = normalizeModifiers(item.optJSONArray("modificadores") ?: item.optJSONArray("modifiers") ?: JSONArray())
        return JSONObject()
            .put("id", id)
            .put("producto_id", item.optString("producto_id").ifBlank { item.optString("productId").ifBlank { item.optString("id") } })
            .put("nombre", item.optString("nombre").ifBlank { item.optString("name").ifBlank { "Producto" } })
            .put("cantidad", item.optDouble("cantidad", item.optDouble("quantity", 1.0)))
            .put("modificadores", modifiers)
            .put("estado_cocina", item.optString("estado_cocina").ifBlank { "PENDIENTE" })
            .put("hora_inicio_preparacion", item.opt("hora_inicio_preparacion") ?: JSONObject.NULL)
            .put("note", item.optString("note", ""))
    }

    private fun normalizeModifiers(modifiers: JSONArray): JSONArray {
        val result = JSONArray()
        for (index in 0 until modifiers.length()) {
            val raw = modifiers.opt(index)
            val label = when (raw) {
                is JSONObject -> raw.optString("label")
                    .ifBlank { raw.optString("name") }
                    .ifBlank { raw.optString("nombre") }
                    .ifBlank { raw.optString("note") }
                else -> raw?.toString().orEmpty()
            }.trim()
            if (label.isNotBlank()) result.put(label)
        }
        return result
    }

    private fun mergeItems(existing: JSONArray?, incoming: JSONArray): JSONArray {
        val byId = LinkedHashMap<String, JSONObject>()
        if (existing != null) {
            for (index in 0 until existing.length()) {
                val item = existing.optJSONObject(index) ?: continue
                byId[item.optString("id", "existing-$index")] = item
            }
        }
        for (index in 0 until incoming.length()) {
            val item = incoming.optJSONObject(index) ?: continue
            val id = item.optString("id", "incoming-$index")
            val current = byId[id]
            byId[id] = if (current == null) item else mergeItemSnapshot(current, item)
        }
        val result = JSONArray()
        byId.values.forEach { item -> result.put(item) }
        return result
    }

    private fun mergeItemSnapshot(current: JSONObject, incoming: JSONObject): JSONObject {
        val next = JSONObject(incoming.toString())
        val currentStatus = current.optString("estado_cocina")
        if (currentStatus.isNotBlank() && currentStatus != "PENDIENTE") {
            next.put("estado_cocina", currentStatus)
            next.put("hora_inicio_preparacion", current.opt("hora_inicio_preparacion") ?: JSONObject.NULL)
        }
        return next
    }

    private fun activeOrders(): JSONArray {
        val result = JSONArray()
        orders.values
            .sortedBy { it.optString("date") }
            .forEach { order ->
                val items = order.optJSONArray("items") ?: JSONArray()
                var hasPending = false
                for (index in 0 until items.length()) {
                    val status = items.optJSONObject(index)?.optString("estado_cocina") ?: "PENDIENTE"
                    if (status == "PENDIENTE" || status == "EN_PREPARACION") {
                        hasPending = true
                        break
                    }
                }
                if (hasPending) result.put(order)
            }
        return result
    }

    private fun updateStatus(itemId: String, orderId: String, status: String) {
        if (itemId.isNotBlank()) {
            orders.values.forEach { order ->
                val items = order.optJSONArray("items") ?: return@forEach
                for (index in 0 until items.length()) {
                    val item = items.optJSONObject(index) ?: continue
                    if (item.optString("id") == itemId) {
                        item.put("estado_cocina", status)
                        if (status == "EN_PREPARACION") item.put("hora_inicio_preparacion", isoNow())
                    }
                }
            }
            return
        }

        if (orderId.isNotBlank()) {
            val order = orders[orderId] ?: return
            val items = order.optJSONArray("items") ?: return
            for (index in 0 until items.length()) {
                val item = items.optJSONObject(index) ?: continue
                item.put("estado_cocina", status)
                if (status == "EN_PREPARACION") item.put("hora_inicio_preparacion", isoNow())
            }
        }
    }

    private fun parseObject(body: String): JSONObject {
        if (body.isBlank()) return JSONObject()
        return runCatching { JSONObject(body) }.getOrElse { JSONObject() }
    }

    private fun readAsciiLine(input: java.io.InputStream): String {
        val buffer = ByteArrayOutputStream()
        while (true) {
            val value = input.read()
            if (value == -1) break
            if (value == '\n'.code) break
            if (value != '\r'.code) buffer.write(value)
        }
        return buffer.toString(StandardCharsets.US_ASCII.name())
    }

    private fun writeResponse(socket: Socket, statusCode: Int, body: String) {
        val statusText = when (statusCode) {
            200 -> "OK"
            204 -> "No Content"
            400 -> "Bad Request"
            404 -> "Not Found"
            else -> "Internal Server Error"
        }
        val bytes = body.toByteArray(StandardCharsets.UTF_8)
        val headers = buildString {
            append("HTTP/1.1 $statusCode $statusText\r\n")
            append("Content-Type: application/json; charset=utf-8\r\n")
            append("Access-Control-Allow-Origin: *\r\n")
            append("Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS\r\n")
            append("Access-Control-Allow-Headers: Content-Type\r\n")
            append("Content-Length: ${bytes.size}\r\n")
            append("Connection: close\r\n")
            append("\r\n")
        }
        val output = socket.getOutputStream()
        output.write(headers.toByteArray(StandardCharsets.US_ASCII))
        if (bytes.isNotEmpty()) output.write(bytes)
        output.flush()
    }

    private fun getLocalIpv4Addresses(): List<String> {
        return try {
            val interfaces = NetworkInterface.getNetworkInterfaces()
            val interfaceEntries = if (interfaces != null) Collections.list(interfaces) else emptyList()
            interfaceEntries
                .filter { iface -> runCatching { iface.isUp && !iface.isLoopback && !iface.isVirtual }.getOrDefault(false) }
                .flatMap { iface ->
                    Collections.list(iface.inetAddresses).mapNotNull { address ->
                        val ipv4 = address as? Inet4Address ?: return@mapNotNull null
                        val hostAddress = ipv4.hostAddress ?: return@mapNotNull null
                        if (ipv4.isLoopbackAddress || hostAddress.startsWith("127.") || !ipv4.isSiteLocalAddress) return@mapNotNull null
                        iface.name to hostAddress
                    }
                }
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

    private fun isoNow(): String {
        return java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US).format(java.util.Date())
    }
}
