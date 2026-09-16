package com.clicpos.nativeprinter

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.Socket
import java.nio.charset.StandardCharsets
import org.json.JSONObject

private class CountedInput(private val bytes: ByteArray, private val fragment: Int = Int.MAX_VALUE) : InputStream() {
    var offset = 0
    var singles = 0
    var bulks = 0
    override fun read(): Int { singles++; return if (offset < bytes.size) bytes[offset++].toInt() and 255 else -1 }
    override fun read(target: ByteArray, start: Int, length: Int): Int {
        bulks++
        if (length == 0) return 0
        if (offset >= bytes.size) return -1
        val size = minOf(length, fragment, bytes.size - offset)
        bytes.copyInto(target, start, offset, offset + size); offset += size
        return size
    }
}
private class FixtureSocket(val counted: CountedInput) : Socket() {
    val output = ByteArrayOutputStream()
    var closedByServer = false
    override fun getInputStream(): InputStream = counted
    override fun getOutputStream() = output
    override fun close() { closedByServer = true }
}
private fun wire(body: ByteArray, target: String = "/api/sync/auth", length: Int = body.size): ByteArray =
    "POST $target HTTP/1.1\r\nContent-Length: $length\r\nX-Sync-Token: fixture-only\r\n\r\n".toByteArray() + body
private fun serve(bytes: ByteArray, fragment: Int = Int.MAX_VALUE): Pair<String, FixtureSocket> {
    val socket = FixtureSocket(CountedInput(bytes, fragment))
    val handler = ClicPOSMasterHttpServer.javaClass.getDeclaredMethod("handleClient", Socket::class.java)
    handler.isAccessible = true; handler.invoke(ClicPOSMasterHttpServer, socket)
    check(socket.closedByServer && socket.soTimeout == 5000)
    return socket.output.toString("UTF-8") to socket
}
fun main() {
    val body = "{\"terminalId\":\"café-桌\",\"deviceToken\":\"fixture-only\"}".toByteArray(StandardCharsets.UTF_8)
    val raw = CountedInput(wire(body))
    val lineReader = ClicPOSMasterHttpServer.javaClass.getDeclaredMethod("readAsciiLine", InputStream::class.java)
    lineReader.isAccessible = true
    while ((lineReader.invoke(ClicPOSMasterHttpServer, raw) as String).isNotBlank()) { /* real baseline reader */ }
    val bulk = FixtureSocket(CountedInput(wire(body)))
    ProductionHttpParserFixture.parse(bulk)
    check(raw.singles > 70 && bulk.counted.singles == 0 && bulk.counted.bulks == 1) { "headers caused underlying single-byte reads" }
    println("PASS: underlying reads baseline single=${raw.singles}; candidate single=${bulk.counted.singles}, bulk=${bulk.counted.bulks}")
    for (fragment in listOf(Int.MAX_VALUE, 1, 2, 7, 31)) {
        val socket = FixtureSocket(CountedInput(wire(body), fragment))
        val parsed = ProductionHttpParserFixture.parse(socket)!!
        check(parsed.body == String(body, StandardCharsets.UTF_8)) { "prefetched/fragmented body lost" }
        check(parsed.headers["content-length"] == body.size.toString())
        check(socket.counted.singles == 0) { "headers caused underlying single-byte reads" }
    }
    println("PASS: shared prefetch buffer, fragmented reads, UTF8 byte-length, bulk underlying reads")
    val binary = byteArrayOf(0, 13, 10, 0xff.toByte(), 0xc3.toByte(), 0x28, 65)
    for (fragment in listOf(Int.MAX_VALUE, 1, 7)) {
        val parsed = ProductionHttpParserFixture.parse(FixtureSocket(CountedInput(wire(binary) + byteArrayOf(66), fragment)))!!
        check(parsed.body == String(binary, StandardCharsets.UTF_8)) { "binary/invalid UTF8 decoding changed" }
    }
    val truncated = ProductionHttpParserFixture.parse(FixtureSocket(CountedInput(wire(body.copyOf(9), length = body.size))))!!
    check(truncated.body == String(body.copyOf(9), StandardCharsets.UTF_8))
    check(ProductionHttpParserFixture.parse(FixtureSocket(CountedInput(byteArrayOf()))) == null)
    check(ProductionHttpParserFixture.parse(FixtureSocket(CountedInput("GET /api/health HTTP/1.1".toByteArray())))!!.body == "")
    check(ProductionHttpParserFixture.parse(FixtureSocket(CountedInput("GET /api/health HTTP/1.1\r\n\r\n".toByteArray())))!!.body == "")
    check(ProductionHttpParserFixture.parse(FixtureSocket(CountedInput(wire(byteArrayOf()))))!!.body == "")
    println("PASS: binary/null/CRLF/sentinel boundaries, empty/partial EOF and zero body")
    val health = serve("GET /api/health HTTP/1.1\r\n\r\n".toByteArray()).first
    check(health.startsWith("HTTP/1.1 200 OK"))
    check(JSONObject(health.substringAfter("\r\n\r\n")).getString("runtime") == "ANDROID_MASTER")
    check(serve("OPTIONS /api/mesas HTTP/1.1\r\n\r\n".toByteArray()).first.startsWith("HTTP/1.1 204 No Content"))
    val mesas = JSONObject(serve("GET /api/mesas HTTP/1.1\r\n\r\n".toByteArray()).first.substringAfter("\r\n\r\n"))
    check(mesas.keySet() == setOf("rooms", "tables", "parkedTickets", "customers", "productRoutingUpdates", "revision"))
    for (fragment in listOf(Int.MAX_VALUE, 1, 7)) {
        val auth = serve(wire(body), fragment).first
        check(auth.startsWith("HTTP/1.1 200 OK"))
        check(JSONObject(auth.substringAfter("\r\n\r\n")).getString("terminalId") == "café-桌")
    }
    check(serve(wire(binary)).first.startsWith("HTTP/1.1 400 Bad Request"))
    check(serve("GET /api/sync/config HTTP/1.1\r\nX-Sync-Token: invalid-fixture\r\n\r\n".toByteArray()).first.startsWith("HTTP/1.1 401 Unauthorized"))
    check(serve("GET /unknown HTTP/1.1\r\n\r\n".toByteArray()).first.startsWith("HTTP/1.1 404 Not Found"))
    println("PASS: actual full native handler routes, auth rejection, snapshot schema, timeout and closure")
}
