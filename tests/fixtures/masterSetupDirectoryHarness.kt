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
                invoke("bindTerminal", accepted, JSONObject().put("terminal_id", "Caja 01")
                    .put("pos_device_id", "test-device").put("tenant_id", "tenant").put("force_transfer", true), true)
                accepted.shutdownOutput()
                check(client.getInputStream().bufferedReader().readText().contains("TERMINAL_OCCUPIED"))
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
