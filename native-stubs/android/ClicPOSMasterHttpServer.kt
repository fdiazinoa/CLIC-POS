package com.clicpos.nativeprinter

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
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

    fun start(context: Context, requestedPort: Int = DEFAULT_PORT, config: JSONObject? = null): JSONObject {
        config?.let { configSnapshot = JSONObject(it.toString()) }
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

    fun updateConfig(config: JSONObject): JSONObject {
        configSnapshot = JSONObject(config.toString())
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
                404 -> "Not Found"
                else -> "Internal Server Error"
            }
            val bytes = body.toByteArray(StandardCharsets.UTF_8)
            val headers = buildString {
                append("HTTP/1.1 $status $statusText\r\n")
                append("Content-Type: application/json; charset=utf-8\r\n")
                append("Access-Control-Allow-Origin: *\r\n")
                append("Access-Control-Allow-Methods: GET, PUT, OPTIONS\r\n")
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
