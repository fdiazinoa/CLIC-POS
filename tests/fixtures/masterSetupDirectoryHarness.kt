package com.clicpos.nativeprinter

import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import org.json.JSONArray
import org.json.JSONObject

// Runs the real native server on the JVM with org.json, without building an APK.
fun main() {
    val server = ClicPOSMasterHttpServer
    fun invoke(name: String, vararg args: Any): Any? {
        val method = server.javaClass.declaredMethods.first { it.name == name && it.parameterCount == args.size }
        method.isAccessible = true
        return try { method.invoke(server, *args) } catch (error: java.lang.reflect.InvocationTargetException) {
            throw error.targetException
        }
    }
    val configField = server.javaClass.getDeclaredField("configSnapshot").also { it.isAccessible = true }
    fun setConfig(snapshot: JSONObject) { configField.set(server, snapshot) }
    fun record(id: String, type: String = "ORDER_TAKER", company: String = "company", store: String = "store",
        tenant: String = "tenant", master: String = "master", device: String = ""): JSONObject = JSONObject()
        .put("id", id).put("name", id).put("terminal_type", type).put("tenant_id", tenant)
        .put("company_id", company).put("store_id", store).put("master_terminal_id", master).put("device_id", device)
    var status = 200
    var requests = 0
    var requestedQuery = ""
    var directory = JSONArray().put(record("master", "STANDARD_POS", master = ""))
        .put(record("Caja 01")).put(record("POS-005", company = "other"))
        .put(record("other-store", store = "other")).put(record("other-tenant", tenant = "other"))
        .put(record("other-master", master = "other"))
        .put(record("archived").put("status", "archived"))
    val http = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    val terminalUuid = "0efd23be-d73f-42aa-ab7d-5895b56edee0"
    val requestUuid = "ff405c30-1fd7-4f03-a1d1-36e997250e44"
    var devicePosts = 0
    var deviceRequestStatus = "PENDING"
    http.createContext("/api/sync/terminals/$terminalUuid/device-requests") { exchange ->
        check(exchange.requestHeaders.getFirst("X-Device-Id") == "DEV-50WKC4HD")
        if (exchange.requestMethod == "POST") {
            devicePosts++
            val payload = JSONObject(exchange.requestBody.bufferedReader().readText())
            check(payload.length() == 5 && !payload.has("force_transfer"))
        }
        val receipt = JSONObject().put("success", true).put("request_id", requestUuid)
            .put("status", deviceRequestStatus).put("terminal_id", terminalUuid).put("requested_device_id", "DEV-50WKC4HD")
        if (exchange.requestMethod == "GET") receipt.put("binding_authorized", false)
        val bytes = receipt.toString().toByteArray()
        exchange.sendResponseHeaders(200, bytes.size.toLong())
        exchange.responseBody.use { it.write(bytes) }
    }
    http.createContext("/api/sync/terminals") { exchange ->
        requests++
        requestedQuery = exchange.requestURI.rawQuery
        val bytes = JSONObject().put("terminals", directory).toString().toByteArray()
        exchange.sendResponseHeaders(status, bytes.size.toLong())
        exchange.responseBody.use { it.write(bytes) }
    }
    http.start()
    try {
        val original = JSONObject().put("runtimeTerminalId", "master").put("masterSetupContext", JSONObject()
            .put("tenantId", "tenant").put("companyId", "company").put("storeId", "store")
            .put("erpEnabled", true).put("erpBaseUrl", "http://127.0.0.1:${http.address.port}"))
            .put("terminals", JSONArray().put(JSONObject().put("id", "Caja 01").put("config", JSONObject()
                .put("terminalType", "STANDARD_POS").put("isPrimaryNode", true)
                .put("deviceRole", JSONObject().put("role", "STANDARD_POS")))))
        setConfig(original)
        val list = invoke("buildTerminalListResponse", "/api/setup/terminals?pos_device_id=test-device") as JSONObject
        check(requestedQuery == "tenant_id=tenant&company_id=company&store_id=store")
        check(list.getString("tenant_id") == "tenant")
        val rows = list.getJSONArray("terminals")
        check(rows.length() == 2) // Deliberately unfiltered ERP response must be isolated locally.
        val order = rows.getJSONObject(1)
        check(order.getString("terminal_type") == "ORDER_TAKER")
        check(order.getString("master_terminal_id") == "master")
        check(order.getJSONObject("config").getJSONObject("deviceRole").getString("role") == "ORDER_TAKER")
        check(!order.getJSONObject("config").getBoolean("isPrimaryNode"))
        check(order.getJSONObject("config").getJSONObject("syncConfig").getString("mode") == "SLAVE")
        check(original.getJSONArray("terminals").getJSONObject(0).getJSONObject("config").getString("terminalType") == "STANDARD_POS")
        println("PASS: fresh role, scope isolation, master association, no operational mutation")
        try {
            invoke("buildTerminalListResponse", "/api/setup/terminals?tenant_id=other")
            error("tenant mismatch was accepted")
        } catch (error: IllegalStateException) { check(error.message!!.contains("TENANT_MISMATCH")) }
        println("PASS: tenant mismatch rejected")
        status = 503
        try {
            invoke("buildTerminalListResponse", "/api/setup/terminals")
            error("stale fallback was accepted")
        } catch (error: IllegalStateException) { check(error.message!!.contains("DIRECTORY_UNAVAILABLE")) }
        println("PASS: ERP failure never returns stale directory")
        status = 200
        directory = JSONArray().put(record("Caja 01", device = "other-device"))
        ServerSocket(0).use { listener ->
            val client = Socket("127.0.0.1", listener.localPort)
            listener.accept().use { accepted ->
                try {
                    invoke("bindTerminal", accepted, JSONObject().put("terminal_id", "Caja 01")
                        .put("pos_device_id", "test-device").put("tenant_id", "tenant").put("force_transfer", true), true)
                    error("forced takeover accepted")
                } catch (error: IllegalStateException) { check(error.message!!.contains("FORCE_TRANSFER_FORBIDDEN")) }
            }
            client.close()
        }
        println("PASS: ERP occupied terminal rejects forced takeover")
        try {
            invoke("buildInitialConfigResponse", "Caja 01", "/api/setup/initial-config/Caja?pos_device_id=test-device")
            error("unbound initial-config was accepted")
        } catch (error: IllegalStateException) { check(error.message!!.contains("TERMINAL_NOT_BOUND")) }
        directory = JSONArray().put(record("Caja 01", device = "test-device"))
        check((invoke("buildInitialConfigResponse", "Caja 01", "/api/setup/initial-config/Caja?pos_device_id=test-device") as JSONObject)
            .getString("tenant_id") == "tenant")
        println("PASS: initial-config validates scope and device binding")
        val requestSnapshot = JSONObject(original.toString())
        val requestContext = requestSnapshot.getJSONObject("masterSetupContext")
        val requestPayload = JSONObject().put("tenant_id", "9eda7d73-76e4-4432-ad13-4934fefe8f69")
            .put("company_id", "6b6153ce-501e-4702-9ae9-34a3f1ab9042")
            .put("store_id", "de8dd318-12e7-4a3f-b0e8-4ea1bdb70c07")
            .put("terminal_id", terminalUuid).put("device_id", "DEV-50WKC4HD")
        for ((field, key) in listOf("tenant_id" to "tenantId", "company_id" to "companyId", "store_id" to "storeId")) {
            requestContext.put(key, requestPayload.getString(field))
        }
        directory = JSONArray().put(record(terminalUuid, tenant = requestPayload.getString("tenant_id"),
            company = requestPayload.getString("company_id"), store = requestPayload.getString("store_id"), device = "DEV-HUUCIX17"))
        setConfig(requestSnapshot)
        fun request(payload: JSONObject, read: Boolean): String {
            return ServerSocket(0).use { listener ->
                Socket("127.0.0.1", listener.localPort).use { client ->
                    listener.accept().use { accepted ->
                        invoke("handleDeviceRequest", accepted, payload, read)
                        accepted.shutdownOutput()
                        client.getInputStream().bufferedReader().readText()
                    }
                }
            }
        }
        val beforeSnapshot = requestSnapshot.toString()
        check((invoke("buildTerminalListResponse", "/api/setup/terminals?pos_device_id=DEV-50WKC4HD") as JSONObject)
            .getJSONArray("terminals").getJSONObject(0).getBoolean("can_request_authorization"))
        check(devicePosts == 0) // GET directory never creates requests.
        repeat(2) { check(request(requestPayload, false).contains(requestUuid)) }
        check(devicePosts == 2)
        val query = JSONObject(requestPayload.toString()).put("request_id", requestUuid)
        check(request(query, true).contains("PENDING"))
        deviceRequestStatus = "APPROVED"
        check(request(query, true).contains("\"binding_authorized\":false"))
        for (badPayload in listOf(JSONObject(requestPayload.toString()).put("force_transfer", false),
            JSONObject(requestPayload.toString()).put("company_id", "other"),
            JSONObject(requestPayload.toString()).put("terminal_id", "11111111-1111-1111-1111-111111111111"))) {
            try { request(badPayload, false); error("invalid request accepted") }
            catch (error: IllegalStateException) { check(error.message!!.startsWith("DEVICE_REQUEST_")) }
        }
        check(devicePosts == 2 && requestSnapshot.toString() == beforeSnapshot)
        check(directory.getJSONObject(0).getString("device_id") == "DEV-HUUCIX17")
        println("PASS: explicit request proxy, retry receipt, pending/approved state, scope, forbidden fields and binding unchanged")
        setConfig(original)
        val before = requests
        setConfig(JSONObject(original.toString()).also { it.getJSONObject("masterSetupContext").put("erpEnabled", false) })
        check((invoke("buildTerminalListResponse", "/api/setup/terminals") as JSONObject).getJSONArray("terminals").length() == 1)
        ServerSocket(0).use { listener ->
            val client = Socket("127.0.0.1", listener.localPort)
            listener.accept().use { accepted ->
                invoke("bindTerminal", accepted, JSONObject().put("terminal_id", "Caja 01")
                    .put("pos_device_id", "local-test"), true)
                accepted.shutdownOutput()
                check(client.getInputStream().bufferedReader().readText().contains("200 OK"))
            }
            client.close()
        }
        val localInitial = invoke("buildInitialConfigResponse", "Caja 01", "/api/setup/initial-config/Caja") as JSONObject
        check(localInitial.getJSONObject("config").getJSONArray("terminals").getJSONObject(0)
            .getJSONObject("config").getString("currentDeviceId") == "local-test")
        check(requests == before)
        println("PASS: LOCAL_ONLY list/bind/initial-config perform zero ERP requests")
    } finally { http.stop(0) }
}
