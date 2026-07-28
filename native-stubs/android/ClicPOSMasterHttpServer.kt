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
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

object ClicPOSMasterHttpServer {
    private const val DEFAULT_PORT = 3001
    private val running = AtomicBoolean(false)
    private val executor = Executors.newCachedThreadPool()
    private var serverSocket: ServerSocket? = null
    private var activePort = DEFAULT_PORT
    @Volatile private var configSnapshot = JSONObject()
    @Volatile private var usersSnapshot = JSONArray()

    fun start(
        context: Context,
        requestedPort: Int = DEFAULT_PORT,
        config: JSONObject? = null,
        users: JSONArray? = null
    ): JSONObject {
        config?.let { configSnapshot = JSONObject(it.toString()) }
        users?.let { usersSnapshot = JSONArray(it.toString()) }
        activePort = requestedPort.takeIf { it in 1..65535 } ?: DEFAULT_PORT

        if (running.get()) return status(context)

        return try {
            val socket = ServerSocket(activePort)
            socket.reuseAddress = true
            serverSocket = socket
            running.set(true)

            executor.execute {
                while (running.get()) {
                    try {
                        val client = socket.accept()
                        executor.execute { handleClient(client) }
                    } catch (_: Exception) {
                        if (running.get()) running.set(false)
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
                .put("port", activePort)
                .put("message", error.message ?: "No se pudo iniciar el servidor Master")
        }
    }

    fun updateConfig(config: JSONObject, users: JSONArray? = null): JSONObject {
        configSnapshot = JSONObject(config.toString())
        users?.let { usersSnapshot = JSONArray(it.toString()) }
        return JSONObject()
            .put("status", "success")
            .put("success", true)
            .put("running", running.get())
            .put("port", activePort)
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
        val ips = localIpv4Addresses()
        val localIp = ips.firstOrNull()
        return JSONObject()
            .put("status", if (running.get()) "running" else "stopped")
            .put("success", running.get())
            .put("running", running.get())
            .put("port", activePort)
            .put("localIp", localIp)
            .put("localIps", JSONArray(ips))
            .put("url", if (localIp != null) "http://$localIp:$activePort" else JSONObject.NULL)
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
                val path = (parts.getOrNull(1) ?: "/").substringBefore("?")
                var contentLength = 0

                while (true) {
                    val line = readAsciiLine(input)
                    if (line.isBlank()) break
                    val separator = line.indexOf(':')
                    if (separator > 0 && line.substring(0, separator).trim().equals("content-length", true)) {
                        contentLength = line.substring(separator + 1).trim().toIntOrNull() ?: 0
                    }
                }

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

                when {
                    method == "OPTIONS" -> writeResponse(client, 204, "")
                    method == "GET" && (path == "/api/sync/ping" || path == "/api/health") ->
                        writeResponse(client, 200, JSONObject()
                            .put("success", true)
                            .put("status", "ONLINE")
                            .put("runtime", "ANDROID_MASTER")
                            .toString())
                    method == "GET" && path == "/api/config" ->
                        writeResponse(client, 200, configSnapshot.toString())
                    method == "GET" && path == "/api/users" ->
                        writeResponse(client, 200, usersSnapshot.toString())
                    method == "GET" && path == "/api/setup/terminals" ->
                        writeResponse(client, 200, buildTerminalListResponse(parts.getOrNull(1) ?: path).toString())
                    method == "POST" && path == "/api/setup/bind-terminal" ->
                        handleTerminalBinding(client, body)
                    method == "GET" && path.startsWith("/api/setup/initial-config/") ->
                        writeResponse(
                            client,
                            200,
                            buildInitialConfigResponse(
                                URLDecoder.decode(
                                    path.removePrefix("/api/setup/initial-config/"),
                                    StandardCharsets.UTF_8.name()
                                ),
                                parts.getOrNull(1) ?: path
                            ).toString()
                        )
                    method == "PUT" && path == "/api/config" -> {
                        configSnapshot = if (body.isBlank()) JSONObject() else JSONObject(body)
                        writeResponse(client, 200, configSnapshot.toString())
                    }
                    else -> writeResponse(client, 404, JSONObject()
                        .put("success", false)
                        .put("message", "Endpoint no disponible en el Master Android")
                        .toString())
                }
            } catch (error: Exception) {
                writeResponse(client, 500, JSONObject()
                    .put("success", false)
                    .put("message", error.message ?: "Master server error")
                    .toString())
            }
        }
    }

    private fun buildTerminalListResponse(rawTarget: String): JSONObject {
        val query = parseQuery(rawTarget)
        val deviceId = query.optString("pos_device_id")
        val tenantId = query.optString("tenant_id").ifBlank { "default-tenant" }
        val terminals = configSnapshot.optJSONArray("terminals") ?: JSONArray()
        val result = JSONArray()

        for (index in 0 until terminals.length()) {
            val terminal = terminals.optJSONObject(index) ?: continue
            val terminalId = terminal.optString("id").trim()
            if (terminalId.isBlank()) continue

            val terminalConfig = terminal.optJSONObject("config") ?: JSONObject()
            val currentDeviceId = terminalConfig.optString("currentDeviceId").trim()
            val erpTerminalId = firstNonBlank(
                terminal.optString("erpTerminalId"),
                terminalConfig.optString("erpTerminalId"),
                terminalConfig.optString("erp_terminal_id"),
                terminalId
            )
            val terminalName = firstNonBlank(
                terminal.optString("name"),
                terminalConfig.optString("terminalName"),
                terminalConfig.optString("terminal_name"),
                terminalConfig.optString("stationName"),
                terminalConfig.optString("stationNumber"),
                terminalId
            )
            val terminalType = firstNonBlank(
                terminal.optString("terminalType"),
                terminal.optString("terminal_type"),
                terminalConfig.optString("terminalType"),
                terminalConfig.optString("terminal_type"),
                "STANDARD_POS"
            )
            val masterTerminalId = firstNonBlank(
                terminal.optString("masterTerminalId"),
                terminal.optString("master_terminal_id"),
                terminalConfig.optString("masterTerminalId"),
                terminalConfig.optString("master_terminal_id")
            )
            val capabilities = terminal.optJSONArray("capabilities")
                ?: terminalConfig.optJSONArray("capabilities")
                ?: JSONArray()
            val restrictions = terminal.optJSONArray("restrictions")
                ?: terminalConfig.optJSONArray("restrictions")
                ?: JSONArray()

            result.put(
                JSONObject()
                    .put("id", terminalId)
                    .put("erpTerminalId", erpTerminalId)
                    .put("name", terminalName)
                    .put("location", firstNonBlank(
                        terminal.optString("location"),
                        terminalConfig.optString("storeName"),
                        terminalConfig.optString("store_name"),
                        "Caja Maestra"
                    ))
                    .put("occupied", currentDeviceId.isNotBlank() && currentDeviceId != deviceId)
                    .put("currentDeviceId", if (currentDeviceId.isBlank()) JSONObject.NULL else currentDeviceId)
                    .put("terminal_type", terminalType)
                    .put("terminalType", terminalType)
                    .put("master_terminal_id", if (masterTerminalId.isBlank()) JSONObject.NULL else masterTerminalId)
                    .put("masterTerminalId", if (masterTerminalId.isBlank()) JSONObject.NULL else masterTerminalId)
                    .put("capabilities", JSONArray(capabilities.toString()))
                    .put("restrictions", JSONArray(restrictions.toString()))
                    .put("config", JSONObject(terminalConfig.toString()))
            )
        }

        return JSONObject()
            .put("tenant_id", tenantId)
            .put("source", "ANDROID_MASTER")
            .put("terminals", result)
    }

    private fun handleTerminalBinding(socket: Socket, body: String) {
        val payload = if (body.isBlank()) JSONObject() else JSONObject(body)
        val selectedTerminalId = firstNonBlank(
            payload.optString("terminal_id"),
            payload.optString("erp_terminal_id")
        )
        val deviceId = firstNonBlank(
            payload.optString("pos_device_id"),
            payload.optString("device_id")
        )
        val tenantId = firstNonBlank(
            payload.optString("tenant_id"),
            payload.optString("tenantId"),
            "default-tenant"
        )
        val forceTransfer = payload.optBoolean("force_transfer", false)
        val terminals = configSnapshot.optJSONArray("terminals") ?: JSONArray()
        var selectedTerminal: JSONObject? = null

        for (index in 0 until terminals.length()) {
            val terminal = terminals.optJSONObject(index) ?: continue
            val config = terminal.optJSONObject("config") ?: JSONObject().also {
                terminal.put("config", it)
            }
            val id = terminal.optString("id").trim()
            val erpId = firstNonBlank(
                terminal.optString("erpTerminalId"),
                config.optString("erpTerminalId"),
                config.optString("erp_terminal_id")
            )

            if (id != selectedTerminalId && erpId != selectedTerminalId) continue

            val currentDeviceId = config.optString("currentDeviceId").trim()
            if (currentDeviceId.isNotBlank() && currentDeviceId != deviceId && !forceTransfer) {
                writeResponse(
                    socket,
                    409,
                    JSONObject()
                        .put("success", false)
                        .put("code", "TERMINAL_OCCUPIED")
                        .put("message", "La terminal ya está ocupada por otro equipo.")
                        .put("current_device_id", currentDeviceId)
                        .toString()
                )
                return
            }

            config
                .put("currentDeviceId", deviceId)
                .put("lastPairingDate", java.time.Instant.now().toString())
                .put("isPrimaryNode", false)
                .put("governedByMaster", true)
            val syncConfig = config.optJSONObject("syncConfig") ?: JSONObject()
            syncConfig.put("mode", "SLAVE").put("isEnabled", true)
            config.put("syncConfig", syncConfig)
            selectedTerminal = terminal
            break
        }

        val boundTerminal = selectedTerminal
        if (boundTerminal == null) {
            writeResponse(
                socket,
                404,
                JSONObject()
                    .put("success", false)
                    .put("message", "La terminal seleccionada no existe en la Maestra.")
                    .toString()
            )
            return
        }

        configSnapshot = JSONObject(configSnapshot.toString())
        val terminalConfig = boundTerminal.optJSONObject("config") ?: JSONObject()
        val terminalId = boundTerminal.optString("id")
        val erpTerminalId = firstNonBlank(
            boundTerminal.optString("erpTerminalId"),
            terminalConfig.optString("erpTerminalId"),
            terminalConfig.optString("erp_terminal_id"),
            terminalId
        )
        val terminalName = firstNonBlank(
            boundTerminal.optString("name"),
            terminalConfig.optString("terminalName"),
            terminalConfig.optString("stationName"),
            terminalConfig.optString("stationNumber"),
            terminalId
        )
        val terminalType = firstNonBlank(
            boundTerminal.optString("terminalType"),
            boundTerminal.optString("terminal_type"),
            terminalConfig.optString("terminalType"),
            terminalConfig.optString("terminal_type"),
            "STANDARD_POS"
        )
        val masterTerminalId = firstNonBlank(
            boundTerminal.optString("masterTerminalId"),
            boundTerminal.optString("master_terminal_id"),
            terminalConfig.optString("masterTerminalId"),
            terminalConfig.optString("master_terminal_id")
        )

        writeResponse(
            socket,
            200,
            JSONObject()
                .put("success", true)
                .put("source", "ANDROID_MASTER")
                .put("tenant_id", tenantId)
                .put("terminal_id", terminalId)
                .put("erp_terminal_id", erpTerminalId)
                .put("terminal_name", terminalName)
                .put("terminal_type", terminalType)
                .put("master_terminal_id", if (masterTerminalId.isBlank()) JSONObject.NULL else masterTerminalId)
                .put("capabilities", terminalConfig.optJSONArray("capabilities") ?: JSONArray())
                .put("restrictions", terminalConfig.optJSONArray("restrictions") ?: JSONArray())
                .put("config", JSONObject(configSnapshot.toString()))
                .put("users", JSONArray(usersSnapshot.toString()))
                .toString()
        )
    }

    private fun buildInitialConfigResponse(terminalId: String, rawTarget: String): JSONObject {
        val query = parseQuery(rawTarget)
        return JSONObject()
            .put("success", true)
            .put("source", "ANDROID_MASTER")
            .put("tenant_id", query.optString("tenant_id").ifBlank { "default-tenant" })
            .put("terminal_id", query.optString("local_terminal_id").ifBlank { terminalId })
            .put("erp_terminal_id", terminalId)
            .put("config", JSONObject(configSnapshot.toString()))
            .put("rooms", configSnapshot.optJSONArray("rooms") ?: JSONArray())
            .put("tables", configSnapshot.optJSONArray("tables") ?: JSONArray())
    }

    private fun parseQuery(rawTarget: String): JSONObject {
        val result = JSONObject()
        val query = rawTarget.substringAfter('?', "")
        if (query.isBlank()) return result

        query.split('&').forEach { pair ->
            val key = URLDecoder.decode(pair.substringBefore('='), StandardCharsets.UTF_8.name())
            val value = URLDecoder.decode(pair.substringAfter('=', ""), StandardCharsets.UTF_8.name())
            if (key.isNotBlank()) result.put(key, value)
        }
        return result
    }

    private fun firstNonBlank(vararg values: String): String =
        values.firstOrNull { it.isNotBlank() } ?: ""

    private fun readAsciiLine(input: java.io.InputStream): String {
        val output = ByteArrayOutputStream()
        while (true) {
            val value = input.read()
            if (value == -1 || value == '\n'.code) break
            if (value != '\r'.code) output.write(value)
        }
        return output.toString(StandardCharsets.UTF_8.name())
    }

    private fun writeResponse(socket: Socket, status: Int, body: String) {
        runCatching {
            val statusText = when (status) {
                200 -> "OK"
                204 -> "No Content"
                400 -> "Bad Request"
                409 -> "Conflict"
                404 -> "Not Found"
                else -> "Internal Server Error"
            }
            val bytes = body.toByteArray(StandardCharsets.UTF_8)
            val headers = buildString {
                append("HTTP/1.1 $status $statusText\r\n")
                append("Content-Type: application/json; charset=utf-8\r\n")
                append("Access-Control-Allow-Origin: *\r\n")
                append("Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS\r\n")
                append("Access-Control-Allow-Headers: Content-Type, X-Active-Terminal-Id, X-Device-Id\r\n")
                append("Connection: close\r\n")
                append("Content-Length: ${bytes.size}\r\n\r\n")
            }
            socket.getOutputStream().apply {
                write(headers.toByteArray(StandardCharsets.UTF_8))
                if (bytes.isNotEmpty()) write(bytes)
                flush()
            }
        }
    }

    private fun localIpv4Addresses(): List<String> {
        val addresses = mutableListOf<String>()
        runCatching {
            for (networkInterface in Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!networkInterface.isUp || networkInterface.isLoopback) continue
                for (address in Collections.list(networkInterface.inetAddresses)) {
                    if (address is Inet4Address && !address.isLoopbackAddress) {
                        addresses.add(address.hostAddress ?: continue)
                    }
                }
            }
        }
        return addresses.distinct()
    }
}
