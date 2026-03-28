package com.clicpos.nativeprinter

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import java.io.IOException
import java.util.UUID
import kotlin.math.min

class ClicPOSBluetoothPrinterManager(private val context: Context) {

    data class PrinterDeviceInfo(
        val id: String,
        val name: String,
        val address: String,
        val status: String = "DISCONNECTED",
        val type: String = "LABEL",
        val connection: String = "BLUETOOTH"
    )

    data class PrintResult(
        val status: String,
        val success: Boolean,
        val printed: Boolean,
        val message: String,
        val errorCode: String? = null
    )

    private val adapter: BluetoothAdapter? = BluetoothAdapter.getDefaultAdapter()
    private val lock = Any()
    private var socket: BluetoothSocket? = null
    private var connectedAddress: String? = null
    private var connectedName: String? = null

    private val queue = ArrayDeque<ByteArray>()
    private val maxQueueItems = 120

    private val sppUuid: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

    fun discoverBondedPrinters(): List<PrinterDeviceInfo> {
        checkAdapter()
        ensureConnectPermission()

        val bonded = adapter?.bondedDevices ?: emptySet()
        return bonded
            .filter { it.address?.isNotBlank() == true }
            .map { device ->
                val isConnected = connectedAddress != null && connectedAddress.equals(device.address, ignoreCase = true)
                PrinterDeviceInfo(
                    id = device.address,
                    name = device.name ?: "BT Printer",
                    address = device.address,
                    status = if (isConnected) "CONNECTED" else "DISCONNECTED",
                    type = "LABEL",
                    connection = "BLUETOOTH"
                )
            }
            .sortedBy { it.name.lowercase() }
    }

    fun pairPrinter(address: String?, fallbackName: String?): PrinterDeviceInfo {
        checkAdapter()
        ensureConnectPermission()

        val target = resolveTargetDevice(address, fallbackName)
            ?: throw PrinterBridgeException("No printer found to pair.", "PRINTER_NOT_FOUND")

        if (target.bondState == BluetoothDevice.BOND_BONDED) {
            return PrinterDeviceInfo(
                id = target.address,
                name = target.name ?: (fallbackName ?: "BT Printer"),
                address = target.address,
                status = "CONNECTED"
            )
        }

        val initiated = createBondSafely(target)
        if (!initiated) {
            throw PrinterBridgeException("Unable to start pairing for ${target.address}", "PAIR_START_FAILED")
        }

        val paired = waitForBond(target, timeoutMs = 12000)
        if (!paired) {
            throw PrinterBridgeException("Pairing timeout for ${target.address}", "PAIR_TIMEOUT")
        }

        return PrinterDeviceInfo(
            id = target.address,
            name = target.name ?: (fallbackName ?: "BT Printer"),
            address = target.address,
            status = "CONNECTED"
        )
    }

    fun printEscPos(rawBytes: ByteArray, printerAddress: String?, printerName: String?, printerId: String?): PrintResult {
        if (rawBytes.isEmpty()) {
            return PrintResult(
                status = "error",
                success = false,
                printed = false,
                message = "ESC/POS payload is empty.",
                errorCode = "PAYLOAD_INVALID"
            )
        }

        synchronized(lock) {
            return try {
                val targetAddress = firstNonBlank(printerAddress, printerId)

                if (!ensureConnected(targetAddress, printerName)) {
                    enqueue(rawBytes)
                    PrintResult(
                        status = "queued",
                        success = true,
                        printed = false,
                        message = "Printer unavailable. Job queued."
                    )
                } else {
                    writeNow(rawBytes)
                    flushQueueIfPossible()
                    PrintResult(
                        status = "success",
                        success = true,
                        printed = true,
                        message = "ESC/POS printed successfully."
                    )
                }
            } catch (e: PrinterBridgeException) {
                enqueue(rawBytes)
                PrintResult(
                    status = "queued",
                    success = true,
                    printed = false,
                    message = e.message ?: "Printer unavailable. Job queued.",
                    errorCode = e.code
                )
            } catch (e: Exception) {
                enqueue(rawBytes)
                PrintResult(
                    status = "queued",
                    success = true,
                    printed = false,
                    message = e.message ?: "Unexpected print error. Job queued.",
                    errorCode = "PRINT_ERROR"
                )
            }
        }
    }

    fun printHtmlAsText(html: String, printerAddress: String?, printerName: String?, printerId: String?): PrintResult {
        val text = html
            .replace(Regex("<script[\\s\\S]*?</script>", RegexOption.IGNORE_CASE), "")
            .replace(Regex("<style[\\s\\S]*?</style>", RegexOption.IGNORE_CASE), "")
            .replace(Regex("<[^>]+>"), "\n")
            .replace("&nbsp;", " ")
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace(Regex("\\n{3,}"), "\n\n")
            .trim()

        val bytes = if (text.isBlank()) byteArrayOf() else (text + "\n\n").toByteArray(Charsets.UTF_8)
        return printEscPos(bytes, printerAddress, printerName, printerId)
    }

    fun testConnection(printerAddress: String?, printerName: String?, printerId: String?): PrintResult {
        synchronized(lock) {
            return try {
                val targetAddress = firstNonBlank(printerAddress, printerId)
                val connected = ensureConnected(targetAddress, printerName)
                PrintResult(
                    status = if (connected) "ONLINE" else "OFFLINE",
                    success = connected,
                    printed = false,
                    message = if (connected) "Bluetooth printer connected successfully." else "Bluetooth printer is offline.",
                    errorCode = if (connected) null else "CONNECT_FAILED"
                )
            } catch (e: PrinterBridgeException) {
                PrintResult(
                    status = "OFFLINE",
                    success = false,
                    printed = false,
                    message = e.message ?: "Bluetooth printer is offline.",
                    errorCode = e.code
                )
            } catch (e: Exception) {
                PrintResult(
                    status = "OFFLINE",
                    success = false,
                    printed = false,
                    message = e.message ?: "Unexpected Bluetooth test error.",
                    errorCode = "TEST_ERROR"
                )
            }
        }
    }

    fun close() {
        synchronized(lock) {
            closeSocketQuietly(socket)
            socket = null
            connectedAddress = null
            connectedName = null
        }
    }

    private fun enqueue(bytes: ByteArray) {
        if (bytes.isEmpty()) return

        if (queue.size >= maxQueueItems) {
            val overflow = min(8, queue.size)
            repeat(overflow) { queue.removeFirstOrNull() }
        }
        queue.addLast(bytes)
    }

    private fun flushQueueIfPossible() {
        if (queue.isEmpty()) return

        val activeSocket = socket ?: return
        val out = activeSocket.outputStream ?: return

        while (queue.isNotEmpty()) {
            val packet = queue.removeFirstOrNull() ?: continue
            out.write(packet)
            out.flush()
        }
    }

    @SuppressLint("MissingPermission")
    private fun ensureConnected(preferredAddress: String?, preferredName: String?): Boolean {
        checkAdapter()
        ensureConnectPermission()

        val activeSocket = socket
        if (activeSocket != null && activeSocket.isConnected) {
            if (preferredAddress.isNullOrBlank() || preferredAddress.equals(connectedAddress, ignoreCase = true)) {
                return true
            }
            close()
        }

        val target = resolveTargetDevice(preferredAddress, preferredName)
            ?: throw PrinterBridgeException("No target Bluetooth printer found.", "PRINTER_NOT_FOUND")

        if (target.bondState != BluetoothDevice.BOND_BONDED) {
            val paired = waitForPairingIfNeeded(target)
            if (!paired) {
                throw PrinterBridgeException("Printer is not paired: ${target.address}", "NOT_PAIRED")
            }
        }

        if (adapter?.isDiscovering == true) {
            adapter.cancelDiscovery()
        }

        val newSocket = target.createRfcommSocketToServiceRecord(sppUuid)
        try {
            newSocket.connect()
        } catch (e: IOException) {
            closeSocketQuietly(newSocket)
            throw PrinterBridgeException(
                message = "Unable to connect to ${target.address}",
                code = "CONNECT_FAILED",
                cause = e
            )
        }

        socket = newSocket
        connectedAddress = target.address
        connectedName = target.name
        return true
    }

    private fun writeNow(rawBytes: ByteArray) {
        val activeSocket = socket
            ?: throw PrinterBridgeException("No active socket", "SOCKET_NOT_READY")

        try {
            val out = activeSocket.outputStream
            out.write(rawBytes)
            out.flush()
        } catch (e: IOException) {
            close()
            throw PrinterBridgeException("Write failed", "WRITE_FAILED", e)
        }
    }

    @SuppressLint("MissingPermission")
    private fun resolveTargetDevice(address: String?, fallbackName: String?): BluetoothDevice? {
        val bonded = adapter?.bondedDevices ?: emptySet()
        if (bonded.isEmpty()) return null

        val byAddress = address
            ?.takeIf { it.isNotBlank() }
            ?.let { preferred -> bonded.firstOrNull { it.address.equals(preferred, ignoreCase = true) } }
        if (byAddress != null) return byAddress

        val byName = fallbackName
            ?.takeIf { it.isNotBlank() }
            ?.let { preferred -> bonded.firstOrNull { (it.name ?: "").equals(preferred, ignoreCase = true) } }
        if (byName != null) return byName

        val lastConnected = connectedAddress
            ?.let { last -> bonded.firstOrNull { it.address.equals(last, ignoreCase = true) } }
        if (lastConnected != null) return lastConnected

        return bonded.firstOrNull()
    }

    @SuppressLint("MissingPermission")
    private fun waitForPairingIfNeeded(device: BluetoothDevice): Boolean {
        if (device.bondState == BluetoothDevice.BOND_BONDED) return true

        val started = createBondSafely(device)
        if (!started) return false

        return waitForBond(device, timeoutMs = 10000)
    }

    @SuppressLint("MissingPermission")
    private fun createBondSafely(device: BluetoothDevice): Boolean {
        return try {
            if (device.bondState == BluetoothDevice.BOND_BONDED) true else device.createBond()
        } catch (_: SecurityException) {
            false
        } catch (_: Exception) {
            false
        }
    }

    @SuppressLint("MissingPermission")
    private fun waitForBond(device: BluetoothDevice, timeoutMs: Long): Boolean {
        val start = System.currentTimeMillis()
        while (System.currentTimeMillis() - start < timeoutMs) {
            if (device.bondState == BluetoothDevice.BOND_BONDED) return true
            if (device.bondState == BluetoothDevice.BOND_NONE) {
                Thread.sleep(300)
                continue
            }
            Thread.sleep(250)
        }
        return device.bondState == BluetoothDevice.BOND_BONDED
    }

    private fun checkAdapter() {
        val bt = adapter ?: throw PrinterBridgeException("Bluetooth adapter not available.", "BT_NOT_SUPPORTED")
        if (!bt.isEnabled) {
            throw PrinterBridgeException("Bluetooth is disabled.", "BT_DISABLED")
        }
    }

    private fun ensureConnectPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return

        val granted = context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
        if (!granted) {
            throw PrinterBridgeException("Missing BLUETOOTH_CONNECT permission.", "PERMISSION_DENIED")
        }
    }

    private fun closeSocketQuietly(value: BluetoothSocket?) {
        try {
            value?.close()
        } catch (_: Exception) {
        }
    }

    private fun firstNonBlank(first: String?, second: String?): String? {
        if (!first.isNullOrBlank()) return first
        if (!second.isNullOrBlank()) return second
        return null
    }

    class PrinterBridgeException(
        override val message: String,
        val code: String,
        cause: Throwable? = null
    ) : RuntimeException(message, cause)
}
