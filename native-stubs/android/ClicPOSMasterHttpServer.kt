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
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

object ClicPOSMasterHttpServer {
    private const val DEFAULT_PORT = 3001
    private const val PREFS_NAME = "clic_pos_master_bindings"
    private const val PREFS_BINDINGS_KEY = "terminal_device_bindings"
    private const val PREFS_RESTAURANT_KEY = "restaurant_state"
    private const val TABLE_EDIT_LOCK_TTL_MS = 45_000L
    private val running = AtomicBoolean(false)
    private val executor = Executors.newCachedThreadPool()
    private var serverSocket: ServerSocket? = null
    private var activePort = DEFAULT_PORT
    @Volatile private var appContext: Context? = null
    @Volatile private var configSnapshot = JSONObject()
    @Volatile private var usersSnapshot = JSONArray()
    @Volatile private var roomsSnapshot = JSONArray()
    @Volatile private var tablesSnapshot = JSONArray()
    @Volatile private var parkedTicketsSnapshot = JSONArray()
    @Volatile private var catalogSnapshots = JSONObject()
    private val restaurantRevision = AtomicLong(0)
    private val syncTokens = ConcurrentHashMap<String, String>()
    private val catalogVersions = ConcurrentHashMap<String, Long>()
    private val tableEditLocks = ConcurrentHashMap<String, JSONObject>()
    @Volatile private var restaurantStateLoaded = false

    fun start(
        context: Context,
        requestedPort: Int = DEFAULT_PORT,
        config: JSONObject? = null,
        users: JSONArray? = null,
        rooms: JSONArray? = null,
        tables: JSONArray? = null,
        parkedTickets: JSONArray? = null,
        catalogs: JSONObject? = null,
        acknowledgedRestaurantRevision: Long = 0
    ): JSONObject {
        appContext = context.applicationContext
        restoreRestaurantSnapshot()
        config?.let { configSnapshot = applyPersistedBindings(JSONObject(it.toString())) }
        users?.let { usersSnapshot = JSONArray(it.toString()) }
        catalogs?.let { updateCatalogSnapshots(it) }
        updateRestaurantSnapshotFromWebView(
            rooms,
            tables,
            parkedTickets,
            acknowledgedRestaurantRevision
        )
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

    fun updateConfig(
        config: JSONObject,
        users: JSONArray? = null,
        rooms: JSONArray? = null,
        tables: JSONArray? = null,
        parkedTickets: JSONArray? = null,
        catalogs: JSONObject? = null,
        acknowledgedRestaurantRevision: Long = 0
    ): JSONObject {
        configSnapshot = applyPersistedBindings(JSONObject(config.toString()))
        users?.let { usersSnapshot = JSONArray(it.toString()) }
        catalogs?.let { updateCatalogSnapshots(it) }
        updateRestaurantSnapshotFromWebView(
            rooms,
            tables,
            parkedTickets,
            acknowledgedRestaurantRevision
        )
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
                val headers = mutableMapOf<String, String>()

                while (true) {
                    val line = readAsciiLine(input)
                    if (line.isBlank()) break
                    val separator = line.indexOf(':')
                    if (separator > 0) {
                        val headerName = line.substring(0, separator).trim().lowercase()
                        val headerValue = line.substring(separator + 1).trim()
                        headers[headerName] = headerValue
                        if (headerName == "content-length") {
                            contentLength = headerValue.toIntOrNull() ?: 0
                        }
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
                    method == "POST" && path == "/api/sync/auth" ->
                        handleSyncAuth(client, body)
                    method == "GET" && path == "/api/sync/config" ->
                        handleSyncConfig(client, headers)
                    method == "GET" && path.startsWith("/api/sync/collections/") && path.endsWith("/metadata") ->
                        handleSyncCollectionMetadata(client, path, headers)
                    method == "GET" && path.startsWith("/api/sync/collections/") && path.endsWith("/data") ->
                        handleSyncCollectionData(client, path, parts.getOrNull(1) ?: path, headers)
                    method == "GET" && path.startsWith("/api/sync/delta/") ->
                        handleSyncCollectionDelta(client, path, parts.getOrNull(1) ?: path, headers)
                    method == "GET" && path == "/api/config" ->
                        writeResponse(client, 200, configSnapshot.toString())
                    method == "GET" && path == "/api/users" ->
                        writeResponse(client, 200, usersSnapshot.toString())
                    method == "GET" && path == "/api/mesas" ->
                        writeResponse(client, 200, buildRestaurantSnapshot().toString())
                    method == "POST" && path == "/api/mesas/bloquear" ->
                        writeLockResponse(client, acquireTableEditLock(parseJsonBody(body)))
                    method == "POST" && path == "/api/mesas/desbloquear" ->
                        writeLockResponse(client, releaseTableEditLock(parseJsonBody(body)))
                    method == "PUT" && path == "/api/mesas/parked-tickets" ->
                        handleParkedTicketsUpdate(client, body)
                    method == "POST" && path == "/api/mesas/abrir" ->
                        handleOpenTable(client, body)
                    method == "POST" && path == "/api/mesas/liberar" ->
                        handleReleaseTable(client, body)
                    method == "GET" && path == "/api/setup/terminals" ->
                        writeResponse(client, 200, buildTerminalListResponse(parts.getOrNull(1) ?: path).toString())
                    method == "GET" && path == "/api/setup/claim-terminal" ->
                        handleTerminalClaim(client, parts.getOrNull(1) ?: path)
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
        bindTerminal(socket, payload, includeSnapshot = true)
    }

    private fun handleTerminalClaim(socket: Socket, rawTarget: String) {
        bindTerminal(socket, parseQuery(rawTarget), includeSnapshot = false)
    }

    private fun bindTerminal(socket: Socket, payload: JSONObject, includeSnapshot: Boolean) {
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
            || payload.optString("force_transfer").equals("true", ignoreCase = true)
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
            persistTerminalBinding(id, deviceId)
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

        val response = JSONObject()
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

        if (includeSnapshot) {
            response
                .put("config", JSONObject(configSnapshot.toString()))
                .put("users", JSONArray(usersSnapshot.toString()))
        }

        writeResponse(socket, 200, response.toString())
    }

    /**
     * The Android Master owns this snapshot while it is serving LAN clients.  The
     * WebView sends a fresh copy whenever the local restaurant state changes and
     * clients can update parked tickets through the same Master endpoint.
     */
    private fun updateRestaurantSnapshot(
        rooms: JSONArray? = null,
        tables: JSONArray? = null,
        parkedTickets: JSONArray? = null
    ) {
        rooms?.let { roomsSnapshot = JSONArray(it.toString()) }
        tables?.let { tablesSnapshot = JSONArray(it.toString()) }
        parkedTickets?.let { parkedTicketsSnapshot = JSONArray(it.toString()) }
    }

    /**
     * A WebView snapshot may only replace native state after it has observed the
     * latest client revision. This prevents an unrelated React render from
     * restoring stale tickets immediately after a client changes a table.
     */
    private fun updateRestaurantSnapshotFromWebView(
        rooms: JSONArray? = null,
        tables: JSONArray? = null,
        parkedTickets: JSONArray? = null,
        acknowledgedRevision: Long = 0
    ) {
        if (acknowledgedRevision < restaurantRevision.get()) return
        val changed =
            (rooms != null && rooms.toString() != roomsSnapshot.toString()) ||
            (tables != null && tables.toString() != tablesSnapshot.toString()) ||
            (parkedTickets != null && parkedTickets.toString() != parkedTicketsSnapshot.toString())
        updateRestaurantSnapshot(rooms, tables, parkedTickets)
        if (changed) restaurantRevision.incrementAndGet()
        persistRestaurantSnapshot()
    }

    private fun updateCatalogSnapshots(catalogs: JSONObject) {
        val previous = catalogSnapshots
        val next = JSONObject(catalogs.toString())
        val keys = next.keys()
        while (keys.hasNext()) {
            val collection = keys.next()
            val nextItems = next.optJSONArray(collection) ?: JSONArray()
            val previousItems = previous.optJSONArray(collection)
            if (previousItems == null || previousItems.toString() != nextItems.toString()) {
                val now = System.currentTimeMillis()
                val priorVersion = catalogVersions[collection] ?: 0
                catalogVersions[collection] = maxOf(now, priorVersion + 1)
            }
        }
        catalogSnapshots = next
    }

    private fun applyClientRestaurantMutation(
        rooms: JSONArray? = null,
        tables: JSONArray? = null,
        parkedTickets: JSONArray? = null
    ) {
        updateRestaurantSnapshot(rooms, tables, parkedTickets)
        restaurantRevision.incrementAndGet()
        persistRestaurantSnapshot()
    }

    private fun restoreRestaurantSnapshot() {
        if (restaurantStateLoaded) return
        restaurantStateLoaded = true
        val context = appContext ?: return
        val raw = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(PREFS_RESTAURANT_KEY, null)
        val persisted = runCatching {
            if (raw.isNullOrBlank()) null else JSONObject(raw)
        }.getOrNull() ?: return

        roomsSnapshot = persisted.optJSONArray("rooms") ?: JSONArray()
        tablesSnapshot = persisted.optJSONArray("tables") ?: JSONArray()
        parkedTicketsSnapshot = persisted.optJSONArray("parkedTickets") ?: JSONArray()
        restaurantRevision.set(persisted.optLong("revision", 0))
    }

    private fun persistRestaurantSnapshot() {
        val context = appContext ?: return
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(PREFS_RESTAURANT_KEY, buildRestaurantSnapshot().toString())
            .apply()
    }

    private fun handleSyncAuth(socket: Socket, body: String) {
        val payload = runCatching {
            if (body.isBlank()) JSONObject() else JSONObject(body)
        }.getOrElse {
            writeResponse(socket, 400, JSONObject()
                .put("success", false)
                .put("message", "Solicitud de autenticación inválida")
                .toString())
            return
        }
        val terminalId = firstNonBlank(
            payload.optString("terminalId"),
            payload.optString("terminal_id")
        )
        val deviceId = firstNonBlank(
            payload.optString("deviceToken"),
            payload.optString("device_id")
        )
        if (terminalId.isBlank() || deviceId.isBlank()) {
            writeResponse(socket, 400, JSONObject()
                .put("success", false)
                .put("message", "terminalId y deviceToken son requeridos")
                .toString())
            return
        }

        val token = "sync_${UUID.randomUUID()}"
        syncTokens[token] = terminalId
        writeResponse(socket, 200, JSONObject()
            .put("success", true)
            .put("token", token)
            .put("terminalId", terminalId)
            .put("expiresIn", 86400000)
            .toString())
    }

    private fun handleSyncConfig(
        socket: Socket,
        headers: Map<String, String>
    ) {
        if (!authorizeSyncRequest(socket, headers)) return
        writeResponse(socket, 200, JSONObject()
            .put("success", true)
            .put("config", JSONObject(configSnapshot.toString()))
            .toString())
    }

    private fun handleSyncCollectionMetadata(
        socket: Socket,
        path: String,
        headers: Map<String, String>
    ) {
        if (!authorizeSyncRequest(socket, headers)) return
        val collection = path
            .removePrefix("/api/sync/collections/")
            .removeSuffix("/metadata")
            .trim('/')
        val items = getSyncCollection(collection)
        val version = collectionVersion(collection, items)
        writeResponse(socket, 200, JSONObject()
            .put("success", true)
            .put("metadata", JSONObject()
                .put("collection", collection)
                .put("version", version)
                .put("fullSyncVersion", version)
                .put("itemCount", items.length())
                .put("lastUpdated", java.time.Instant.now().toString()))
            .toString())
    }

    private fun handleSyncCollectionData(
        socket: Socket,
        path: String,
        rawTarget: String,
        headers: Map<String, String>
    ) {
        if (!authorizeSyncRequest(socket, headers)) return
        val collection = path
            .removePrefix("/api/sync/collections/")
            .removeSuffix("/data")
            .trim('/')
        val items = getSyncCollection(collection)
        val version = collectionVersion(collection, items)
        val sinceVersion = parseQuery(rawTarget).optLong("sinceVersion", 0)
        writeResponse(socket, 200, JSONObject()
            .put("success", true)
            .put("items", if (sinceVersion >= version && version > 0) JSONArray() else items)
            .put("version", version)
            .put("itemCount", items.length())
            .put("upToDate", sinceVersion >= version && version > 0)
            .put("lastUpdated", java.time.Instant.now().toString())
            .toString())
    }

    private fun handleSyncCollectionDelta(
        socket: Socket,
        path: String,
        rawTarget: String,
        headers: Map<String, String>
    ) {
        if (!authorizeSyncRequest(socket, headers)) return
        val collection = path.removePrefix("/api/sync/delta/").trim('/')
        val items = getSyncCollection(collection)
        val version = collectionVersion(collection, items)
        val sinceVersion = parseQuery(rawTarget).optLong("sinceVersion", 0)
        val changed = sinceVersion < version || version == 0L
        writeResponse(socket, 200, JSONObject()
            .put("success", true)
            .put("items", if (changed) items else JSONArray())
            .put("serverTime", java.time.Instant.now().toString())
            .put("isFullDownload", changed)
            .put("latestVersion", version)
            .toString())
    }

    private fun authorizeSyncRequest(
        socket: Socket,
        headers: Map<String, String>
    ): Boolean {
        val token = headers["x-sync-token"].orEmpty()
        if (token.isNotBlank() && syncTokens.containsKey(token)) return true
        writeResponse(socket, 401, JSONObject()
            .put("success", false)
            .put("message", "Invalid or missing sync token")
            .toString())
        return false
    }

    private fun getSyncCollection(collection: String): JSONArray = when (collection) {
        "users" -> JSONArray(usersSnapshot.toString())
        "rooms" -> JSONArray(roomsSnapshot.toString())
        "tables" -> JSONArray(tablesSnapshot.toString())
        "parkedTickets" -> JSONArray(parkedTicketsSnapshot.toString())
        else -> catalogSnapshots.optJSONArray(collection)?.let { JSONArray(it.toString()) } ?: JSONArray()
    }

    private fun collectionVersion(collection: String, items: JSONArray): Long {
        if (collection == "rooms" || collection == "tables" || collection == "parkedTickets") {
            return restaurantRevision.get().coerceAtLeast(1)
        }
        return catalogVersions[collection]
            ?: (items.toString().hashCode().toLong() and 0x7fffffffL).coerceAtLeast(1)
    }

    private fun parseJsonBody(body: String): JSONObject =
        if (body.isBlank()) JSONObject() else JSONObject(body)

    private fun cleanupExpiredTableLocks(now: Long = System.currentTimeMillis()) {
        var removed = false
        for ((tableId, lock) in tableEditLocks.entries) {
            if (lock.optLong("expiresAt", 0) <= now && tableEditLocks.remove(tableId, lock)) {
                removed = true
            }
        }
        if (removed) restaurantRevision.incrementAndGet()
    }

    private fun activeTableLock(tableId: String): JSONObject? {
        cleanupExpiredTableLocks()
        return tableEditLocks[tableId]?.let { JSONObject(it.toString()) }
    }

    private fun publicTableLock(lock: JSONObject): JSONObject =
        JSONObject(lock.toString()).apply { remove("token") }

    @Synchronized
    fun acquireTableEditLock(payload: JSONObject): JSONObject {
        val tableId = payload.optString("tableId").trim()
        val ownerId = payload.optString("ownerId").trim()
        if (tableId.isBlank() || ownerId.isBlank()) {
            return JSONObject()
                .put("success", false)
                .put("code", "TABLE_LOCK_INPUT_REQUIRED")
                .put("message", "tableId y ownerId son requeridos")
                .put("_httpStatus", 400)
        }

        val now = System.currentTimeMillis()
        cleanupExpiredTableLocks(now)
        val current = tableEditLocks[tableId]
        if (current != null && current.optString("ownerId") != ownerId) {
            return JSONObject()
                .put("success", false)
                .put("code", "TABLE_EDIT_LOCKED")
                .put("message", "La mesa está siendo editada en otra terminal.")
                .put("lock", publicTableLock(current))
                .put("_httpStatus", 409)
        }

        val token = current?.optString("token")?.takeIf { it.isNotBlank() }
            ?: UUID.randomUUID().toString()
        val acquiredAt = current?.optLong("acquiredAt", now) ?: now
        val lock = JSONObject()
            .put("tableId", tableId)
            .put("ownerId", ownerId)
            .put("terminalId", payload.optString("terminalId"))
            .put("userId", payload.optString("userId"))
            .put("userName", payload.optString("userName"))
            .put("token", token)
            .put("acquiredAt", acquiredAt)
            .put("expiresAt", now + TABLE_EDIT_LOCK_TTL_MS)
        tableEditLocks[tableId] = lock
        if (current == null) {
            restaurantRevision.incrementAndGet()
        }

        return JSONObject()
            .put("success", true)
            .put("lock", JSONObject(lock.toString()))
            .put("_httpStatus", 200)
    }

    @Synchronized
    fun releaseTableEditLock(payload: JSONObject): JSONObject {
        val tableId = payload.optString("tableId").trim()
        val ownerId = payload.optString("ownerId").trim()
        val token = payload.optString("token").trim()
        if (tableId.isBlank()) {
            return JSONObject()
                .put("success", false)
                .put("message", "tableId es requerido")
                .put("_httpStatus", 400)
        }

        val current = activeTableLock(tableId)
        if (current == null) {
            return JSONObject().put("success", true).put("_httpStatus", 200)
        }
        val isOwner = ownerId.isNotBlank() && current.optString("ownerId") == ownerId
        val hasToken = token.isNotBlank() && current.optString("token") == token
        if (!isOwner || !hasToken) {
            return JSONObject()
                .put("success", false)
                .put("code", "TABLE_EDIT_LOCK_OWNERSHIP_MISMATCH")
                .put("message", "La mesa está bloqueada por otra terminal.")
                .put("lock", publicTableLock(current))
                .put("_httpStatus", 409)
        }

        tableEditLocks.remove(tableId)
        restaurantRevision.incrementAndGet()
        return JSONObject().put("success", true).put("_httpStatus", 200)
    }

    private fun writeLockResponse(socket: Socket, result: JSONObject) {
        val status = result.optInt("_httpStatus", if (result.optBoolean("success")) 200 else 400)
        result.remove("_httpStatus")
        writeResponse(socket, status, result.toString())
    }

    private fun buildTablesWithEditLocks(): JSONArray {
        cleanupExpiredTableLocks()
        val tables = JSONArray(tablesSnapshot.toString())
        for (index in 0 until tables.length()) {
            val table = tables.optJSONObject(index) ?: continue
            val tableId = table.optString("id")
            val lock = tableEditLocks[tableId]
            if (lock != null) {
                table.put("editingLock", publicTableLock(lock))
            } else {
                table.remove("editingLock")
            }
        }
        return tables
    }

    private fun buildRestaurantSnapshot(): JSONObject = JSONObject()
        .put("rooms", JSONArray(roomsSnapshot.toString()))
        .put("tables", buildTablesWithEditLocks())
        .put("parkedTickets", JSONArray(parkedTicketsSnapshot.toString()))
        .put("revision", restaurantRevision.get())

    fun getRestaurantState(): JSONObject = buildRestaurantSnapshot()

    private fun handleParkedTicketsUpdate(socket: Socket, body: String) {
        val payload = runCatching { if (body.isBlank()) JSONObject() else JSONObject(body) }
            .getOrElse {
                writeResponse(socket, 400, JSONObject()
                    .put("success", false)
                    .put("message", "Cuerpo de tickets inválido")
                    .toString())
                return
            }
        val tickets = payload.optJSONArray("parkedTickets")
        if (tickets == null) {
            writeResponse(socket, 400, JSONObject()
                .put("success", false)
                .put("message", "parkedTickets debe ser un arreglo")
                .toString())
            return
        }

        val tableId = payload.optString("tableId").trim()
        val ownerId = payload.optString("ownerId").trim()
        val lockToken = payload.optString("lockToken").trim()
        val nextTickets = if (tableId.isNotBlank()) {
            val lock = activeTableLock(tableId)
            val ownsLock = lock != null &&
                lock.optString("ownerId") == ownerId &&
                lock.optString("token") == lockToken
            if (!ownsLock) {
                writeResponse(socket, 409, JSONObject()
                    .put("success", false)
                    .put("code", "TABLE_EDIT_LOCK_REQUIRED")
                    .put("message", "La terminal perdió el bloqueo de edición de la mesa.")
                    .toString())
                return
            }
            mergeTicketsForTable(tableId, tickets)
        } else {
            JSONArray(tickets.toString())
        }

        val reconciledTables = reconcileTablesWithParkedTickets(tablesSnapshot, nextTickets)
        applyClientRestaurantMutation(tables = reconciledTables, parkedTickets = nextTickets)
        writeResponse(socket, 200, JSONObject()
            .put("success", true)
            .put("parkedTickets", JSONArray(parkedTicketsSnapshot.toString()))
            .put("tables", buildTablesWithEditLocks())
            .put("revision", restaurantRevision.get())
            .toString())
    }

    private fun mergeTicketsForTable(tableId: String, incomingTickets: JSONArray): JSONArray {
        val merged = JSONArray()
        for (index in 0 until parkedTicketsSnapshot.length()) {
            val ticket = parkedTicketsSnapshot.optJSONObject(index) ?: continue
            if (ticket.optString("tableId") != tableId) {
                merged.put(JSONObject(ticket.toString()))
            }
        }
        for (index in 0 until incomingTickets.length()) {
            val ticket = incomingTickets.optJSONObject(index) ?: continue
            if (ticket.optString("tableId") == tableId) {
                merged.put(JSONObject(ticket.toString()))
            }
        }
        return merged
    }

    private fun reconcileTablesWithParkedTickets(
        sourceTables: JSONArray,
        tickets: JSONArray
    ): JSONArray {
        val activeByOrderId = mutableMapOf<String, JSONObject>()
        val activeByTableId = mutableMapOf<String, JSONObject>()
        for (index in 0 until tickets.length()) {
            val ticket = tickets.optJSONObject(index) ?: continue
            val items = ticket.optJSONArray("items") ?: JSONArray()
            var hasItems = false
            for (itemIndex in 0 until items.length()) {
                if ((items.optJSONObject(itemIndex)?.optDouble("quantity", 0.0) ?: 0.0) > 0) {
                    hasItems = true
                    break
                }
            }
            if (!hasItems) continue
            ticket.optString("id").takeIf { it.isNotBlank() }?.let { activeByOrderId[it] = ticket }
            ticket.optString("tableId").takeIf { it.isNotBlank() }?.let { activeByTableId[it] = ticket }
        }

        val reconciled = JSONArray(sourceTables.toString())
        for (index in 0 until reconciled.length()) {
            val table = reconciled.optJSONObject(index) ?: continue
            val tableId = table.optString("id")
            val currentOrderId = table.optString("currentOrderId")
            val orderTicket = activeByOrderId[currentOrderId]
            val orderTicketTableId = orderTicket?.optString("tableId").orEmpty()
            val ticket = if (
                orderTicket != null &&
                (orderTicketTableId.isBlank() || orderTicketTableId == tableId)
            ) {
                orderTicket
            } else {
                activeByTableId[tableId]
            }
            if (ticket == null) {
                table
                    .put("status", "FREE")
                    .put("currentOrderId", JSONObject.NULL)
                    .put("currentOrderTotal", 0)
                    .put("timeSeated", JSONObject.NULL)
                continue
            }

            var total = ticket.optDouble("total", Double.NaN)
            if (total.isNaN()) {
                total = 0.0
                val items = ticket.optJSONArray("items") ?: JSONArray()
                for (itemIndex in 0 until items.length()) {
                    val item = items.optJSONObject(itemIndex) ?: continue
                    total += item.optDouble("price", 0.0) * item.optDouble("quantity", 0.0)
                }
            }
            table
                .put("status", "OCCUPIED")
                .put("currentOrderId", ticket.optString("id"))
                .put("currentOrderTotal", total)
                .put("timeSeated", firstNonBlank(
                    table.optString("timeSeated"),
                    ticket.optString("timestamp")
                ))
        }
        return reconciled
    }

    private fun handleOpenTable(socket: Socket, body: String) {
        val payload = runCatching { if (body.isBlank()) JSONObject() else JSONObject(body) }
            .getOrElse {
                writeResponse(socket, 400, JSONObject()
                    .put("status", "error")
                    .put("message", "Cuerpo de mesa inválido")
                    .toString())
                return
            }
        val tableId = payload.optString("tableId").trim()
        if (tableId.isBlank()) {
            writeResponse(socket, 400, JSONObject()
                .put("status", "error")
                .put("message", "tableId es requerido")
                .toString())
            return
        }

        val updatedTables = JSONArray(tablesSnapshot.toString())
        var orderId = ""
        var found = false
        for (index in 0 until updatedTables.length()) {
            val table = updatedTables.optJSONObject(index) ?: continue
            if (table.optString("id") != tableId) continue
            found = true
            orderId = table.optString("currentOrderId").trim()
            if (orderId.isBlank()) {
                orderId = "ORD-${System.currentTimeMillis()}"
                table
                    .put("currentOrderId", orderId)
                    .put("currentOrderTotal", 0)
                    .put("timeSeated", java.time.Instant.now().toString())
                    .put("waiterId", payload.optString("waiterId"))
                    .put("waiterName", payload.optString("waiterName"))
                    .put("status", "OCCUPIED")
            }
            break
        }

        if (!found) {
            writeResponse(socket, 404, JSONObject()
                .put("status", "error")
                .put("message", "Mesa no encontrada")
                .toString())
            return
        }

        applyClientRestaurantMutation(tables = updatedTables)
        writeResponse(socket, 200, JSONObject()
            .put("status", "success")
            .put("orden_id", orderId)
            .toString())
    }

    private fun handleReleaseTable(socket: Socket, body: String) {
        val payload = runCatching { if (body.isBlank()) JSONObject() else JSONObject(body) }
            .getOrElse {
                writeResponse(socket, 400, JSONObject()
                    .put("success", false)
                    .put("message", "Cuerpo de mesa inválido")
                    .toString())
                return
            }
        val tableId = payload.optString("tableId").trim()
        if (tableId.isBlank()) {
            writeResponse(socket, 400, JSONObject()
                .put("success", false)
                .put("message", "tableId es requerido")
                .toString())
            return
        }

        val updatedTables = JSONArray(tablesSnapshot.toString())
        var orderId = ""
        var found = false
        for (index in 0 until updatedTables.length()) {
            val table = updatedTables.optJSONObject(index) ?: continue
            if (table.optString("id") != tableId) continue
            found = true
            orderId = table.optString("currentOrderId").trim()
            table
                .put("status", "FREE")
                .put("currentOrderId", JSONObject.NULL)
                .put("currentOrderTotal", 0)
                .put("timeSeated", JSONObject.NULL)
                .put("waiterId", JSONObject.NULL)
                .put("waiterName", JSONObject.NULL)
            break
        }

        if (!found) {
            writeResponse(socket, 404, JSONObject()
                .put("success", false)
                .put("message", "Mesa no encontrada")
                .toString())
            return
        }

        val remainingTickets = JSONArray()
        for (index in 0 until parkedTicketsSnapshot.length()) {
            val ticket = parkedTicketsSnapshot.optJSONObject(index) ?: continue
            val belongsToTable = ticket.optString("tableId") == tableId
            val belongsToOrder = orderId.isNotBlank() && ticket.optString("id") == orderId
            if (!belongsToTable && !belongsToOrder) remainingTickets.put(ticket)
        }
        applyClientRestaurantMutation(tables = updatedTables, parkedTickets = remainingTickets)
        writeResponse(socket, 200, JSONObject().put("success", true).toString())
    }

    private fun applyPersistedBindings(snapshot: JSONObject): JSONObject {
        val bindings = readPersistedBindings()
        val terminals = snapshot.optJSONArray("terminals") ?: return snapshot
        for (index in 0 until terminals.length()) {
            val terminal = terminals.optJSONObject(index) ?: continue
            val terminalId = terminal.optString("id").trim()
            val persistedDeviceId = bindings.optString(terminalId).trim()
            if (terminalId.isBlank() || persistedDeviceId.isBlank()) continue
            val config = terminal.optJSONObject("config") ?: JSONObject().also {
                terminal.put("config", it)
            }
            config
                .put("currentDeviceId", persistedDeviceId)
                .put("governedByMaster", true)
        }
        return snapshot
    }

    private fun readPersistedBindings(): JSONObject {
        val context = appContext ?: return JSONObject()
        val raw = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(PREFS_BINDINGS_KEY, null)
        return runCatching { if (raw.isNullOrBlank()) JSONObject() else JSONObject(raw) }
            .getOrDefault(JSONObject())
    }

    private fun persistTerminalBinding(terminalId: String, deviceId: String) {
        val context = appContext ?: return
        val bindings = readPersistedBindings()
        bindings.put(terminalId, deviceId)
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(PREFS_BINDINGS_KEY, bindings.toString())
            .apply()
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
                401 -> "Unauthorized"
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
                append("Access-Control-Allow-Headers: Content-Type, X-Active-Terminal-Id, X-Device-Id, X-POS-Device-Id, X-Sync-Token\r\n")
                append("Access-Control-Allow-Private-Network: true\r\n")
                append("Access-Control-Max-Age: 600\r\n")
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
