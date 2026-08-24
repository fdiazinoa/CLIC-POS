/*
 * Android USB host port of the libfprint uru4000 driver.
 *
 * Copyright (C) 2007-2008 Daniel Drake <dsd@gentoo.org>
 * Copyright (C) 2012 Timo Teräs <timo.teras@iki.fi>
 * Copyright (C) 2026 CLIC-POS contributors
 *
 * This file is free software; you can redistribute it and/or modify it under
 * the terms of the GNU Lesser General Public License as published by the Free
 * Software Foundation; either version 2.1 of the License, or (at your option)
 * any later version.
 *
 * Protocol source: libfprint/libfprint/drivers/uru4000.c
 */
package com.clicpos.nativeprinter

import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import java.security.SecureRandom

internal data class Uru4500Capture(
    val grayscale: ByteArray,
    val width: Int,
    val height: Int,
    val capturedLines: Int,
    val encrypted: Boolean,
    val contrast: Int,
)

internal class DigitalPersonaUru4500(
    private val usbManager: UsbManager,
    private val device: UsbDevice,
) : AutoCloseable {
    companion object {
        const val VENDOR_ID = 0x05ba
        const val PRODUCT_ID = 0x000a

        private const val USB_REQUEST = 0x04
        private const val CONTROL_IN = UsbConstants.USB_DIR_IN or UsbConstants.USB_TYPE_VENDOR
        private const val CONTROL_OUT = UsbConstants.USB_DIR_OUT or UsbConstants.USB_TYPE_VENDOR
        private const val CONTROL_TIMEOUT_MS = 5_000
        private const val INTERRUPT_TIMEOUT_MS = 750
        private const val CAPTURE_TIMEOUT_MS = 15_000

        private const val REG_HWSTAT = 0x07
        private const val REG_SCRAMBLE_DATA_INDEX = 0x33
        private const val REG_SCRAMBLE_DATA_KEY = 0x34
        private const val REG_MODE = 0x4e
        private const val REG_DEVICE_INFO = 0xf0

        private const val MODE_AWAIT_FINGER_ON = 0x10
        private const val MODE_CAPTURE = 0x20
        private const val MODE_OFF = 0x70

        private const val IRQ_SCAN_POWER_ON = 0x56aa
        private const val IRQ_FINGER_ON = 0x0101

        private const val IMAGE_WIDTH = 384
        private const val IMAGE_HEIGHT = 290
        private const val IMAGE_HEADER_SIZE = 64
        private const val IMAGE_BUFFER_SIZE = IMAGE_HEADER_SIZE + IMAGE_WIDTH * IMAGE_HEIGHT
        private const val ENCRYPTION_THRESHOLD = 5_000

        private const val BLOCK_CHANGE_KEY = 0x80
        private const val BLOCK_NO_KEY_UPDATE = 0x04
        private const val BLOCK_ENCRYPTED = 0x02
        private const val BLOCK_NOT_PRESENT = 0x01
    }

    private val connection: UsbDeviceConnection = usbManager.openDevice(device)
        ?: throw IllegalStateException("No se pudo abrir el lector DigitalPersona.")
    private val fingerprintInterface: UsbInterface
    private val interruptIn: UsbEndpoint
    private val bulkIn: UsbEndpoint
    private val random = SecureRandom()
    private var claimed = false

    init {
        require(device.vendorId == VENDOR_ID && device.productId == PRODUCT_ID) {
            "El dispositivo seleccionado no es un DigitalPersona U.are.U 4500 (05ba:000a)."
        }
        fingerprintInterface = (0 until device.interfaceCount)
            .map(device::getInterface)
            .firstOrNull {
                it.interfaceClass == UsbConstants.USB_CLASS_VENDOR_SPEC &&
                    it.interfaceSubclass == 0xff && it.interfaceProtocol == 0xff
            } ?: throw IllegalStateException("El lector no expone la interfaz biométrica esperada.")

        interruptIn = endpoints(fingerprintInterface).firstOrNull {
            it.direction == UsbConstants.USB_DIR_IN && it.type == UsbConstants.USB_ENDPOINT_XFER_INT
        } ?: throw IllegalStateException("No se encontró el endpoint de eventos del lector.")
        bulkIn = endpoints(fingerprintInterface).firstOrNull {
            it.direction == UsbConstants.USB_DIR_IN && it.type == UsbConstants.USB_ENDPOINT_XFER_BULK
        } ?: throw IllegalStateException("No se encontró el endpoint de imagen del lector.")

        claimed = connection.claimInterface(fingerprintInterface, true)
        if (!claimed) {
            connection.close()
            throw IllegalStateException("Android no pudo reclamar la interfaz del lector.")
        }
    }

    fun capture(timeoutMs: Int = CAPTURE_TIMEOUT_MS): Uru4500Capture {
        initialize()
        writeRegister(REG_MODE, byteArrayOf(MODE_AWAIT_FINGER_ON.toByte()))
        waitForInterrupt(IRQ_FINGER_ON, timeoutMs)

        writeRegister(REG_MODE, byteArrayOf(MODE_CAPTURE.toByte()))
        val encoded = ByteArray(IMAGE_BUFFER_SIZE)
        val actualLength = connection.bulkTransfer(bulkIn, encoded, encoded.size, timeoutMs)
        if (actualLength <= IMAGE_HEADER_SIZE) {
            throw IllegalStateException("El lector no entregó una imagen (${actualLength.coerceAtLeast(0)} bytes).")
        }
        return decodeCapture(encoded, actualLength)
    }

    private fun initialize() {
        var hwstat = readRegister(REG_HWSTAT, 1)[0].toInt() and 0xff
        if ((hwstat and 0x84) == 0x84) {
            writeRegister(REG_HWSTAT, byteArrayOf((hwstat and 0x0f).toByte()))
            for (attempt in 0 until 100) {
                hwstat = readRegister(REG_HWSTAT, 1)[0].toInt() and 0xff
                if ((hwstat and 0x01) != 0) break
                Thread.sleep(10)
            }
        }
        if ((hwstat and 0x80) == 0) {
            writeRegister(REG_HWSTAT, byteArrayOf((hwstat or 0x80).toByte()))
            hwstat = readRegister(REG_HWSTAT, 1)[0].toInt() and 0xff
        }

        val poweredValue = hwstat and 0x0f
        var powered = false
        for (attempt in 0 until 100) {
            writeRegister(REG_HWSTAT, byteArrayOf(poweredValue.toByte()))
            hwstat = readRegister(REG_HWSTAT, 1)[0].toInt() and 0xff
            if ((hwstat and 0x80) == 0) {
                powered = true
                break
            }
            Thread.sleep(10)
        }
        if (!powered) throw IllegalStateException("El lector no salió del modo de bajo consumo.")

        // The event can arrive before or during the power loop. Drain briefly, but
        // do not reject readers that already consumed it in firmware.
        runCatching { waitForInterrupt(IRQ_SCAN_POWER_ON, 1_000) }
        readRegister(REG_DEVICE_INFO, 16)
    }

    private fun waitForInterrupt(expected: Int, timeoutMs: Int) {
        val deadline = System.currentTimeMillis() + timeoutMs
        val buffer = ByteArray(64)
        while (System.currentTimeMillis() < deadline) {
            val remaining = (deadline - System.currentTimeMillis()).coerceAtMost(INTERRUPT_TIMEOUT_MS.toLong()).toInt()
            val count = connection.bulkTransfer(interruptIn, buffer, buffer.size, remaining.coerceAtLeast(1))
            if (count >= 2) {
                val type = ((buffer[0].toInt() and 0xff) shl 8) or (buffer[1].toInt() and 0xff)
                if (type == expected) return
            }
        }
        if (expected == IRQ_FINGER_ON) {
            throw IllegalStateException("Tiempo agotado: coloque el dedo firmemente sobre el lector.")
        }
        throw IllegalStateException("No llegó el evento de encendido del lector.")
    }

    private fun decodeCapture(buffer: ByteArray, actualLength: Int): Uru4500Capture {
        val numLines = littleEndian16(buffer, 4)
        if (numLines <= 0 || numLines >= IMAGE_HEIGHT || actualLength < IMAGE_HEADER_SIZE + numLines * IMAGE_WIDTH) {
            throw IllegalStateException("Imagen inválida: $numLines líneas, $actualLength bytes.")
        }

        var keyNumber = buffer[6].toInt() and 0xff
        val blockFlags = IntArray(15) { buffer[16 + it * 2].toInt() and 0xff }
        val blockLines = IntArray(15) { buffer[17 + it * 2].toInt() and 0xff }
        val imageData = buffer.copyOfRange(IMAGE_HEADER_SIZE, actualLength)
        val contrast = calculateContrast(imageData, blockFlags, blockLines)
        val encrypted = contrast >= ENCRYPTION_THRESHOLD

        if (encrypted) {
            var block = 0
            var linesDone = 0
            var seed = random.nextInt()
            var key = requestScrambleKey(keyNumber, seed)
            while (block < blockFlags.size && linesDone < numLines) {
                var flags = blockFlags[block]
                val lines = blockLines[block]
                if (lines == 0 || linesDone + lines > IMAGE_HEIGHT) break
                if ((flags and BLOCK_CHANGE_KEY) != 0) {
                    flags = flags and BLOCK_CHANGE_KEY.inv()
                    blockFlags[block] = flags
                    keyNumber = (keyNumber + 1) and 0xff
                    seed = random.nextInt()
                    key = requestScrambleKey(keyNumber, seed)
                    continue
                }
                when (flags and (BLOCK_NO_KEY_UPDATE or BLOCK_ENCRYPTED)) {
                    BLOCK_ENCRYPTED -> key = decode(imageData, linesDone * IMAGE_WIDTH, lines * IMAGE_WIDTH, key)
                    0 -> repeat(lines * IMAGE_WIDTH) { key = updateKey(key) }
                }
                if ((flags and BLOCK_NOT_PRESENT) == 0) linesDone += lines
                block++
            }
        }

        val normalized = ByteArray(IMAGE_WIDTH * IMAGE_HEIGHT) { 0xff.toByte() }
        var sourceLine = 0
        var outputLine = 0
        for (block in blockFlags.indices) {
            val flags = blockFlags[block]
            val lines = blockLines[block]
            if (lines == 0 || sourceLine + lines > IMAGE_HEIGHT || outputLine + lines > IMAGE_HEIGHT) break
            if ((flags and BLOCK_NOT_PRESENT) == 0) {
                for (line in 0 until lines) {
                    val src = (sourceLine + line) * IMAGE_WIDTH
                    val dstLine = IMAGE_HEIGHT - 1 - (outputLine + line)
                    for (x in 0 until IMAGE_WIDTH) {
                        normalized[dstLine * IMAGE_WIDTH + (IMAGE_WIDTH - 1 - x)] =
                            (0xff - (imageData[src + x].toInt() and 0xff)).toByte()
                    }
                }
                sourceLine += lines
            }
            outputLine += lines
        }
        return Uru4500Capture(normalized, IMAGE_WIDTH, IMAGE_HEIGHT, numLines, encrypted, contrast)
    }

    private fun requestScrambleKey(keyNumber: Int, seed: Int): Int {
        writeRegister(
            REG_SCRAMBLE_DATA_INDEX,
            byteArrayOf(
                keyNumber.toByte(), seed.toByte(), (seed ushr 8).toByte(),
                (seed ushr 16).toByte(), (seed ushr 24).toByte(),
            ),
        )
        val bytes = readRegister(REG_SCRAMBLE_DATA_KEY, 4)
        return littleEndian32(bytes, 0) xor seed
    }

    private fun calculateContrast(data: ByteArray, flags: IntArray, lines: IntArray): Int {
        val rows = ArrayList<Int>(2)
        var row = 0
        for (block in flags.indices) {
            if ((flags[block] and BLOCK_NOT_PRESENT) != 0) continue
            repeat(lines[block]) {
                if (rows.size < 2) rows.add(row)
                row++
            }
            if (rows.size == 2) break
        }
        if (rows.size < 2 || (rows[1] + 1) * IMAGE_WIDTH > data.size) return 0
        var mean = 0
        repeat(IMAGE_WIDTH) { x ->
            mean += (data[rows[0] * IMAGE_WIDTH + x].toInt() and 0xff) +
                (data[rows[1] * IMAGE_WIDTH + x].toInt() and 0xff)
        }
        mean /= IMAGE_WIDTH
        var deviation = 0L
        repeat(IMAGE_WIDTH) { x ->
            val value = (data[rows[0] * IMAGE_WIDTH + x].toInt() and 0xff) +
                (data[rows[1] * IMAGE_WIDTH + x].toInt() and 0xff) - mean
            deviation += value.toLong() * value
        }
        return (deviation / IMAGE_WIDTH).toInt()
    }

    private fun decode(data: ByteArray, offset: Int, length: Int, initialKey: Int): Int {
        if (offset < 0 || length <= 0 || offset + length > data.size) {
            throw IllegalStateException("Bloque cifrado fuera de los límites de la imagen.")
        }
        var key = initialKey
        for (i in 0 until length - 1) {
            var xorByte = ((key ushr 4) and 1)
            xorByte = xorByte or (((key ushr 8) and 1) shl 1)
            xorByte = xorByte or (((key ushr 11) and 1) shl 2)
            xorByte = xorByte or (((key ushr 14) and 1) shl 3)
            xorByte = xorByte or (((key ushr 18) and 1) shl 4)
            xorByte = xorByte or (((key ushr 21) and 1) shl 5)
            xorByte = xorByte or (((key ushr 24) and 1) shl 6)
            xorByte = xorByte or (((key ushr 29) and 1) shl 7)
            key = updateKey(key)
            data[offset + i] = ((data[offset + i + 1].toInt() and 0xff) xor xorByte).toByte()
        }
        data[offset + length - 1] = 0
        return updateKey(key)
    }

    private fun updateKey(value: Int): Int {
        var bit = value and 0x9248144d.toInt()
        bit = bit xor (bit shl 16)
        bit = bit xor (bit shl 8)
        bit = bit xor (bit shl 4)
        bit = bit xor (bit shl 2)
        bit = bit xor (bit shl 1)
        return (bit and 0x80000000.toInt()) or (value ushr 1)
    }

    private fun readRegister(register: Int, count: Int): ByteArray {
        val result = ByteArray(count)
        val transferred = connection.controlTransfer(
            CONTROL_IN, USB_REQUEST, register, 0, result, result.size, CONTROL_TIMEOUT_MS,
        )
        if (transferred != count) {
            throw IllegalStateException("Lectura USB incompleta en registro 0x${register.toString(16)}: $transferred/$count.")
        }
        return result
    }

    private fun writeRegister(register: Int, values: ByteArray) {
        val transferred = connection.controlTransfer(
            CONTROL_OUT, USB_REQUEST, register, 0, values, values.size, CONTROL_TIMEOUT_MS,
        )
        if (transferred != values.size) {
            throw IllegalStateException("Escritura USB incompleta en registro 0x${register.toString(16)}: $transferred/${values.size}.")
        }
    }

    private fun endpoints(intf: UsbInterface): List<UsbEndpoint> =
        (0 until intf.endpointCount).map(intf::getEndpoint)

    private fun littleEndian16(data: ByteArray, offset: Int): Int =
        (data[offset].toInt() and 0xff) or ((data[offset + 1].toInt() and 0xff) shl 8)

    private fun littleEndian32(data: ByteArray, offset: Int): Int =
        (data[offset].toInt() and 0xff) or
            ((data[offset + 1].toInt() and 0xff) shl 8) or
            ((data[offset + 2].toInt() and 0xff) shl 16) or
            ((data[offset + 3].toInt() and 0xff) shl 24)

    override fun close() {
        runCatching { writeRegister(REG_MODE, byteArrayOf(MODE_OFF.toByte())) }
        if (claimed) runCatching { connection.releaseInterface(fingerprintInterface) }
        connection.close()
        claimed = false
    }
}
