package com.clicpos.nativeprinter

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import org.json.JSONArray
import org.json.JSONObject
import java.net.Inet4Address
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

object ClicPOSMasterDiscovery {
    private const val SERVICE_TYPE = "_clicpos-master._tcp."
    private const val DEFAULT_TIMEOUT_MS = 3_000L
    private var registrationListener: NsdManager.RegistrationListener? = null
    private var registrationFingerprint = ""

    @Synchronized
    fun advertise(context: Context, port: Int, config: JSONObject): JSONObject {
        val appContext = context.applicationContext
        val manager = appContext.getSystemService(Context.NSD_SERVICE) as NsdManager
        val tenantId = readTenantId(config)
        val terminalId = readPrimaryTerminalId(config)
        val companyName = readCompanyName(config)
        val fingerprint = listOf(port, tenantId, terminalId, companyName).joinToString("|")

        if (registrationListener != null && registrationFingerprint == fingerprint) {
            return JSONObject().put("success", true).put("advertising", true)
        }
        stopAdvertising(appContext)

        val serviceInfo = NsdServiceInfo().apply {
            serviceName = buildServiceName(companyName, terminalId)
            serviceType = SERVICE_TYPE
            setPort(port)
            setAttribute("app", "CLIC-POS")
            setAttribute("role", "MASTER")
            if (tenantId.isNotBlank()) setAttribute("tenant", tenantId.take(120))
            if (terminalId.isNotBlank()) setAttribute("terminal", terminalId.take(80))
            if (companyName.isNotBlank()) setAttribute("company", companyName.take(80))
        }
        val listener = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(registered: NsdServiceInfo) = Unit
            override fun onRegistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                synchronized(this@ClicPOSMasterDiscovery) {
                    registrationListener = null
                    registrationFingerprint = ""
                }
            }
            override fun onServiceUnregistered(serviceInfo: NsdServiceInfo) = Unit
            override fun onUnregistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) = Unit
        }

        return try {
            manager.registerService(serviceInfo, NsdManager.PROTOCOL_DNS_SD, listener)
            registrationListener = listener
            registrationFingerprint = fingerprint
            JSONObject().put("success", true).put("advertising", true)
        } catch (error: Exception) {
            registrationListener = null
            registrationFingerprint = ""
            JSONObject()
                .put("success", false)
                .put("advertising", false)
                .put("message", error.message ?: "No se pudo anunciar la Caja Master")
        }
    }

    @Synchronized
    fun stopAdvertising(context: Context) {
        val listener = registrationListener ?: return
        val manager = context.applicationContext.getSystemService(Context.NSD_SERVICE) as NsdManager
        runCatching { manager.unregisterService(listener) }
        registrationListener = null
        registrationFingerprint = ""
    }

    fun discover(context: Context, timeoutMs: Long = DEFAULT_TIMEOUT_MS): JSONObject {
        val appContext = context.applicationContext
        val manager = appContext.getSystemService(Context.NSD_SERVICE) as NsdManager
        val foundServices = CopyOnWriteArrayList<NsdServiceInfo>()
        val discoveryStarted = CountDownLatch(1)
        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) = discoveryStarted.countDown()
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) = discoveryStarted.countDown()
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) = Unit
            override fun onDiscoveryStopped(serviceType: String) = Unit
            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                if (serviceInfo.serviceType == SERVICE_TYPE && foundServices.none { it.serviceName == serviceInfo.serviceName }) {
                    foundServices.add(serviceInfo)
                }
            }
            override fun onServiceLost(serviceInfo: NsdServiceInfo) {
                foundServices.removeAll { it.serviceName == serviceInfo.serviceName }
            }
        }

        return try {
            manager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
            discoveryStarted.await(800, TimeUnit.MILLISECONDS)
            Thread.sleep(timeoutMs.coerceIn(800L, 6_000L))
            runCatching { manager.stopServiceDiscovery(listener) }

            val masters = JSONArray()
            foundServices.forEach { service ->
                resolveService(manager, service)?.let { masters.put(it) }
            }
            JSONObject()
                .put("success", true)
                .put("masters", masters)
        } catch (error: Exception) {
            runCatching { manager.stopServiceDiscovery(listener) }
            JSONObject()
                .put("success", false)
                .put("masters", JSONArray())
                .put("message", error.message ?: "No se pudo buscar la Caja Master")
        }
    }

    fun identity(config: JSONObject, port: Int): JSONObject = JSONObject()
        .put("success", true)
        .put("status", "online")
        .put("app", "CLIC-POS")
        .put("role", "MASTER")
        .put("runtime", "ANDROID_MASTER")
        .put("port", port)
        .put("tenantId", readTenantId(config))
        .put("terminalId", readPrimaryTerminalId(config))
        .put("companyName", readCompanyName(config))

    private fun resolveService(manager: NsdManager, service: NsdServiceInfo): JSONObject? {
        val latch = CountDownLatch(1)
        var result: JSONObject? = null
        val listener = object : NsdManager.ResolveListener {
            override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) = latch.countDown()
            override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                val host = when (val address = serviceInfo.host) {
                    is Inet4Address -> address.hostAddress
                    else -> address?.hostAddress
                }.orEmpty().substringBefore('%')
                if (host.isNotBlank()) {
                    result = JSONObject()
                        .put("name", serviceInfo.serviceName)
                        .put("host", host)
                        .put("port", serviceInfo.port)
                        .put("url", "http://$host:${serviceInfo.port}")
                        .put("tenantId", readAttribute(serviceInfo, "tenant"))
                        .put("terminalId", readAttribute(serviceInfo, "terminal"))
                        .put("companyName", readAttribute(serviceInfo, "company"))
                }
                latch.countDown()
            }
        }
        runCatching { manager.resolveService(service, listener) }.onFailure { latch.countDown() }
        latch.await(1_200, TimeUnit.MILLISECONDS)
        return result
    }

    private fun readAttribute(serviceInfo: NsdServiceInfo, key: String): String =
        runCatching { serviceInfo.attributes[key]?.toString(Charsets.UTF_8).orEmpty() }.getOrDefault("")

    private fun readTenantId(config: JSONObject): String {
        val direct = firstNonBlank(
            config.optString("tenantId"),
            config.optString("tenant_id"),
            config.optJSONObject("companyInfo")?.optString("tenantId"),
            config.optJSONObject("companyInfo")?.optString("tenant_id")
        )
        if (direct.isNotBlank()) return direct

        val terminals = config.optJSONArray("terminals") ?: return ""
        for (index in 0 until terminals.length()) {
            val terminalConfig = terminals.optJSONObject(index)?.optJSONObject("config") ?: continue
            val terminalTenant = firstNonBlank(
                terminalConfig.optString("tenantId"),
                terminalConfig.optString("tenant_id"),
                terminalConfig.optJSONObject("erpBinding")?.optString("tenantId"),
                terminalConfig.optJSONObject("erpBinding")?.optString("tenant_id")
            )
            if (terminalTenant.isNotBlank()) return terminalTenant
        }
        return ""
    }

    private fun readPrimaryTerminalId(config: JSONObject): String {
        val terminals = config.optJSONArray("terminals") ?: return ""
        for (index in 0 until terminals.length()) {
            val terminal = terminals.optJSONObject(index) ?: continue
            if (terminal.optJSONObject("config")?.optBoolean("isPrimaryNode", false) == true) {
                return terminal.optString("id")
            }
        }
        return ""
    }

    private fun readCompanyName(config: JSONObject): String = firstNonBlank(
        config.optJSONObject("companyInfo")?.optString("name"),
        config.optString("businessName"),
        config.optString("name")
    )

    private fun buildServiceName(companyName: String, terminalId: String): String {
        val suffix = firstNonBlank(companyName, terminalId, "Caja Master")
            .replace(Regex("[^A-Za-z0-9 ÁÉÍÓÚáéíóúÑñ_-]"), "")
            .take(40)
        return "CLIC POS - $suffix"
    }

    private fun firstNonBlank(vararg values: String?): String =
        values.firstOrNull { !it.isNullOrBlank() }?.trim().orEmpty()
}
