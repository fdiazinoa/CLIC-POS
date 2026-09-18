package com.clicpos.nativeprinter

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.lang.management.ManagementFactory
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread
import org.json.JSONArray
import org.json.JSONObject

private val server = ClicPOSMasterHttpServer
private fun field(name: String) = server.javaClass.getDeclaredField(name).also { it.isAccessible = true }
private fun invoke(name: String, vararg args: Any?): Any? {
    val method = server.javaClass.declaredMethods.single { it.name == name && it.parameterCount == args.size }
    method.isAccessible = true
    return try { method.invoke(server, *args) } catch (error: java.lang.reflect.InvocationTargetException) {
        throw error.targetException
    }
}
private fun revision() = (field("restaurantRevision").get(server) as AtomicLong).get()
private class HttpSocket : Socket() {
    val output = ByteArrayOutputStream()
    override fun getInputStream() = ByteArrayInputStream("GET /api/mesas HTTP/1.1\r\n\r\n".toByteArray())
    override fun getOutputStream() = output
    override fun close() {}
}
private fun http(): String {
    val socket = HttpSocket()
    invoke("handleClient", socket)
    val response = socket.output.toString("UTF-8")
    check(response.startsWith("HTTP/1.1 200 OK\r\n"))
    val body = response.substringAfter("\r\n\r\n")
    val length = response.substringAfter("Content-Length: ").substringBefore("\r\n").toInt()
    check(length == body.toByteArray(Charsets.UTF_8).size) { "UTF8 Content-Length mismatch" }
    return body
}
private fun snapshot() = JSONObject(http())
private fun rows(generation: Int, count: Int = 2): JSONArray = JSONArray().apply {
    repeat(count) { index -> put(JSONObject().put("id", "row-$index").put("generation", generation)
        .put("nested", JSONObject().put("text", "café 桌 😀 \"\\\n").put("amount", 100.57)
            .put("nothing", JSONObject.NULL).put("enabled", true).put("empty", JSONArray()))) }
}
private fun publish(rooms: JSONArray = rows(1), tickets: JSONArray = rows(1), customers: JSONArray = rows(1)) {
    invoke("updateRestaurantSnapshot", rooms, JSONArray().put(JSONObject().put("id", "table-1")), tickets)
    invoke("updateCatalogSnapshots", JSONObject().put("customers", customers), revision())
}
private class CountedArray(source: JSONArray) : JSONArray(source.toString()) {
    var encodes = 0
    override fun toString(): String { encodes++; return super.toString() }
}
private fun reset() {
    field("appContext").set(server, null)
    for (name in listOf("roomsSnapshot", "tablesSnapshot", "parkedTicketsSnapshot")) field(name).set(server, JSONArray())
    field("catalogSnapshots").set(server, JSONObject())
    (field("restaurantRevision").get(server) as AtomicLong).set(0)
    for (name in listOf("tableEditLocks", "productRoutingOverrides", "catalogVersions"))
        (field(name).get(server) as ConcurrentHashMap<*, *>).clear()
}

private fun benchmark(label: String) {
    val bean = ManagementFactory.getThreadMXBean() as? com.sun.management.ThreadMXBean
    if (bean?.isThreadAllocatedMemorySupported == true) bean.isThreadAllocatedMemoryEnabled = true
    val threadId = Thread.currentThread().id
    for (customerCount in listOf(50, 500)) {
        reset()
        val customers = JSONArray().apply { repeat(customerCount) { index ->
            put(JSONObject().put("id", "customer-$index").put("name", "Synthetic customer $index")
                .put("details", "café address ".repeat(49)).put("balance", 100.57))
        } }
        publish(JSONArray().put(JSONObject().put("id", "room-1")), JSONArray(), customers)
        field("tablesSnapshot").set(server, JSONArray().apply { repeat(6) { put(JSONObject().put("id", "table-$it")) } })
        repeat(200) { http() }
        val elapsed = LongArray(1000)
        var checksum = 0L
        val beforeBytes = bean?.getThreadAllocatedBytes(threadId) ?: -1
        repeat(elapsed.size) { index ->
            val start = System.nanoTime()
            val body = http()
            elapsed[index] = System.nanoTime() - start
            checksum += body.hashCode()
        }
        val afterBytes = bean?.getThreadAllocatedBytes(threadId) ?: -1
        elapsed.sort()
        println(JSONObject().put("mode", "host-jvm-only").put("variant", label).put("customers", customerCount)
            .put("responseBytes", http().toByteArray(Charsets.UTF_8).size).put("samples", elapsed.size)
            .put("p50Us", elapsed[499] / 1000.0).put("p95Us", elapsed[949] / 1000.0)
            .put("p99Us", elapsed[989] / 1000.0).put("maxUs", elapsed.last() / 1000.0)
            .put("threadAllocatedBytesPerCall", if (beforeBytes >= 0) (afterBytes - beforeBytes) / elapsed.size else -1)
            .put("checksum", checksum))
    }
}

fun main(args: Array<String>) {
    if (args.firstOrNull() == "benchmark") { benchmark(args.getOrElse(1) { "unspecified" }); return }
    reset()
    check(snapshot().similar(server.getRestaurantState()))
    val input = rows(1)
    publish(input, input, input)
    val routing = field("productRoutingOverrides").get(server) as ConcurrentHashMap<String, JSONObject>
    routing["product-1"] = JSONObject().put("productId", "product-1").put("nested", JSONObject().put("value", 1))
    val expected = JSONObject(server.getRestaurantState().toString())
    check(snapshot().similar(expected)) { "HTTP and detached builder differ" }
    check(expected.keySet() == setOf("rooms", "tables", "parkedTickets", "customers", "productRoutingUpdates", "revision"))
    input.getJSONObject(0).getJSONObject("nested").put("text", "input mutation")
    check(snapshot().similar(expected)) { "published input aliases source" }
    val detached = server.getRestaurantState()
    for (name in listOf("rooms", "parkedTickets", "customers")) detached.getJSONArray(name)
        .getJSONObject(0).getJSONObject("nested").put("text", "caller mutation")
    detached.getJSONArray("tables").getJSONObject(0).put("id", "caller table")
    detached.getJSONArray("productRoutingUpdates").getJSONObject(0).getJSONObject("nested").put("value", 99)
    check(snapshot().similar(expected)) { "detached bridge result aliases source" }
    println("PASS: HTTP schema/UTF8/empty/nested/null/decimal equivalence and deep input/bridge isolation")

    val counted = listOf(CountedArray(rows(2)), CountedArray(rows(2)), CountedArray(rows(2)))
    field("roomsSnapshot").set(server, counted[0]); field("parkedTicketsSnapshot").set(server, counted[1])
    field("catalogSnapshots").set(server, JSONObject().put("customers", counted[2]))
    val old = server.getRestaurantState().toString()
    check(counted.all { it.encodes == 1 }) { "baseline clone counter not sensitive" }
    counted.forEach { it.encodes = 0 }
    check(JSONObject(http()).similar(JSONObject(old)))
    check(counted.all { it.encodes == 0 }) { "HTTP reintroduced redundant collection stringify/parse" }
    println("PASS: three baseline source-array stringify calls removed; final response equivalent")

    val owner = JSONObject().put("tableId", "table-1").put("ownerId", "owner-1")
    val first = server.acquireTableEditLock(owner).getJSONObject("lock")
    val lockRevision = revision()
    check(server.getRestaurantRevision().getLong("revision") == lockRevision)
    check((field("tableEditLocks").get(server) as ConcurrentHashMap<String, JSONObject>).containsKey("table-1"))
    val locked = snapshot().getJSONArray("tables").getJSONObject(0).getJSONObject("editingLock")
    check(!locked.has("token") && locked.getLong("expiresAt") == first.getLong("expiresAt"))
    Thread.sleep(3) // Ensure a different renewal millisecond; production TTL remains 45 seconds.
    val renewed = server.acquireTableEditLock(owner).getJSONObject("lock")
    check(revision() == lockRevision && renewed.getLong("expiresAt") > first.getLong("expiresAt"))
    check(server.getRestaurantRevision().getLong("revision") == lockRevision)
    check(snapshot().getJSONArray("tables").getJSONObject(0).getJSONObject("editingLock").getLong("expiresAt") == renewed.getLong("expiresAt"))
    check(server.releaseTableEditLock(JSONObject(owner.toString()).put("token", renewed.getString("token"))).getBoolean("success"))
    check(revision() == lockRevision + 1 && !snapshot().getJSONArray("tables").getJSONObject(0).has("editingLock"))
    server.acquireTableEditLock(owner)
    val expiryRevision = revision()
    // Fixture aging, not a shortened TTL: production cleanup sees an actually expired stored lease.
    val locks = field("tableEditLocks").get(server) as ConcurrentHashMap<String, JSONObject>
    locks["table-1"] = JSONObject(locks["table-1"].toString()).put("expiresAt", System.currentTimeMillis() - 1)
    // Probe first: no full snapshot may be needed to observe lease expiration.
    check(server.getRestaurantRevision().getLong("revision") == expiryRevision + 1)
    check(!locks.containsKey("table-1"))
    check(server.getRestaurantRevision().getLong("revision") == expiryRevision + 1)
    check(!snapshot().getJSONArray("tables").getJSONObject(0).has("editingLock"))
    println("PASS: lock redaction/renewal without revision/release/expiry preserve current overlay")

    val beforeCustomers = revision()
    invoke("updateCatalogSnapshots", JSONObject().put("customers", rows(77)), beforeCustomers)
    check(revision() == beforeCustomers && snapshot().getJSONArray("customers").getJSONObject(0).getInt("generation") == 77)
    invoke("updateCatalogSnapshots", JSONObject(), revision())
    check(snapshot().getJSONArray("customers").length() == 0)
    publish(rows(8), rows(9), rows(10))
    val beforeStale = snapshot()
    invoke("updateRestaurantSnapshotFromWebView", rows(999), null, rows(999), revision() - 1)
    check(snapshot().similar(beforeStale)) { "stale WebView snapshot overwrote native state" }
    println("PASS: customers without restaurant revision, missing collection, publications and stale WebView fence")

    val context = Class.forName("android.content.Context").getDeclaredConstructor().newInstance()
    field("appContext").set(server, context)
    invoke("persistRestaurantSnapshot")
    val persisted = server.getRestaurantState()
    field("restaurantStateLoaded").set(server, false)
    field("roomsSnapshot").set(server, JSONArray()); field("tablesSnapshot").set(server, JSONArray())
    field("parkedTicketsSnapshot").set(server, JSONArray()); routing.clear()
    (field("restaurantRevision").get(server) as AtomicLong).set(0)
    invoke("restoreRestaurantSnapshot")
    check(server.getRestaurantState().similar(persisted)) { "actual persistence/restore roundtrip changed" }
    field("appContext").set(server, null)
    println("PASS: actual native persistence/restore methods with in-memory Preferences boundary")

    val error = AtomicReference<Throwable?>()
    val start = CountDownLatch(1)
    val originals = (0..40).map { rows(it, 12) }
    val originalJson = originals.map { it.toString() }
    val writer = thread { try { start.await(); repeat(400) { index ->
        val fixture = originals[index % originals.size]
        invoke("updateRestaurantSnapshot", fixture, null, fixture)
        invoke("updateCatalogSnapshots", JSONObject().put("customers", fixture), revision())
    } } catch (failure: Throwable) { error.set(failure) } }
    val readers = (0..2).map { thread { try { start.await(); repeat(250) {
        val body = snapshot()
        for (name in listOf("rooms", "parkedTickets", "customers")) {
            val array = body.getJSONArray(name)
            if (array.length() > 0) {
                val generation = array.getJSONObject(0).getInt("generation")
                check((0 until array.length()).all { array.getJSONObject(it).getInt("generation") == generation })
            }
        }
    } } catch (failure: Throwable) { error.set(failure) } } }
    start.countDown(); writer.join(); readers.forEach { it.join() }; error.get()?.let { throw it }
    check(originals.map { it.toString() } == originalJson)
    println("PASS: concurrent publication/750 full HTTP reads preserve complete arrays and input ownership")
}
