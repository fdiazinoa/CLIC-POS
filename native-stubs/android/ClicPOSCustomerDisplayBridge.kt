package com.clicpos.customerdisplay

import android.app.Activity
import android.app.Presentation
import android.content.Context
import android.hardware.display.DisplayManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Display
import android.view.ViewGroup
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.FrameLayout
import org.json.JSONArray
import org.json.JSONObject
import java.lang.ref.WeakReference
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class AndroidCustomerDisplayBridge(
    activity: Activity
) {
    companion object {
        private const val TAG = "ClicPOSCustomerDisplay"

        @JvmStatic
        fun injectContractShim(webView: WebView) {
            val script = """
                (function () {
                  if (!window.AndroidCustomerDisplay) return;

                  var parseResult = function (value) {
                    if (!value) return { success: false, message: 'Empty native response' };
                    if (typeof value === 'string') {
                      try { return JSON.parse(value); } catch (e) { return { success: false, message: String(value) }; }
                    }
                    return value;
                  };

                  var call = function (method, payload) {
                    if (!window.AndroidCustomerDisplay || typeof window.AndroidCustomerDisplay[method] !== 'function') {
                      return Promise.resolve({ success: false, message: 'Missing native customer-display method: ' + method });
                    }
                    var raw = window.AndroidCustomerDisplay[method](JSON.stringify(payload || {}));
                    return Promise.resolve(parseResult(raw));
                  };

                  window.ClicPOSCustomerDisplay = {
                    platform: 'android',
                    launch: function (payload) { return call('launch', payload); },
                    dismiss: function () { return call('dismiss', {}); },
                    probe: function () { return call('probe', {}); }
                  };
                })();
            """.trimIndent()

            webView.post {
                webView.evaluateJavascript(script, null)
            }
        }
    }

    private val activityRef = WeakReference(activity)
    private val mainHandler = Handler(Looper.getMainLooper())
    @Volatile
    private var activePresentation: CustomerDisplayPresentation? = null

    @android.webkit.JavascriptInterface
    fun launch(payloadJson: String?): String {
            val activity = activityRef.get()
            ?: return failure("La actividad principal del POS ya no está disponible.")

        return try {
            val payload = JSONObject(payloadJson ?: "{}")
            val requestedMode = payload.optString("mode", "ANDROID_SECONDARY").uppercase()
            val targetUrl = payload.optString("url", "http://localhost/?view=VISOR").ifBlank { "http://localhost/?view=VISOR" }
            val latch = CountDownLatch(1)
            var result = JSONObject().put("success", false).put("message", "Timeout al abrir visor.")

            mainHandler.post {
                result = try {
                    val display = resolveDisplay(activity, requestedMode)
                        ?: JSONObject()
                            .put("success", false)
                            .put("opened", false)
                            .put("mode", requestedMode)
                            .put("message", missingDisplayMessage(requestedMode))

                    if (display is JSONObject) {
                        display
                    } else {
                        dismissActivePresentation()
                        val presentation = CustomerDisplayPresentation(activity, display as Display, targetUrl)
                        presentation.show()
                        activePresentation = presentation

                        JSONObject()
                            .put("success", true)
                            .put("opened", true)
                            .put("mode", requestedMode)
                            .put("usedSecondScreen", display.displayId != Display.DEFAULT_DISPLAY)
                            .put("displayName", display.name ?: "Display ${display.displayId}")
                            .put("message", "Visor abierto en ${display.name ?: "display secundario"}")
                    }
                } catch (error: Throwable) {
                    Log.w(TAG, "launch failed", error)
                    JSONObject()
                        .put("success", false)
                        .put("opened", false)
                        .put("mode", requestedMode)
                        .put("message", error.message ?: "No se pudo abrir el visor en la pantalla Android.")
                } finally {
                    latch.countDown()
                }
            }

            latch.await(3, TimeUnit.SECONDS)
            result.toString()
        } catch (error: Throwable) {
            failure(error.message ?: "No se pudo interpretar la solicitud del visor.")
        }
    }

    @android.webkit.JavascriptInterface
    fun dismiss(payloadJson: String?): String {
        val latch = CountDownLatch(1)
        var result = JSONObject().put("success", true)
        mainHandler.post {
            try {
                dismissActivePresentation()
                result = JSONObject().put("success", true).put("message", "Visor cerrado.")
            } catch (error: Throwable) {
                result = JSONObject().put("success", false).put("message", error.message ?: "No se pudo cerrar el visor.")
            } finally {
                latch.countDown()
            }
        }
        latch.await(2, TimeUnit.SECONDS)
        return result.toString()
    }

    @android.webkit.JavascriptInterface
    fun probe(payloadJson: String?): String {
        val activity = activityRef.get()
            ?: return JSONObject().put("success", false).put("message", "Activity no disponible").toString()

        return try {
            val manager = activity.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
            val displays = manager.displays
            val payload = JSONArray()
            displays.forEach { display ->
                payload.put(
                    JSONObject()
                        .put("id", display.displayId)
                        .put("name", display.name)
                        .put("flags", display.flags)
                        .put("isDefault", display.displayId == Display.DEFAULT_DISPLAY)
                        .put("rotation", display.rotation)
                        .put("width", display.mode?.physicalWidth ?: 0)
                        .put("height", display.mode?.physicalHeight ?: 0)
                )
            }
            JSONObject().put("success", true).put("displays", payload).toString()
        } catch (error: Throwable) {
            JSONObject().put("success", false).put("message", error.message ?: "No se pudieron consultar los displays").toString()
        }
    }

    private fun resolveDisplay(activity: Activity, requestedMode: String): Any? {
        val manager = activity.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
        val preferred = manager.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION)
            .firstOrNull { it.displayId != Display.DEFAULT_DISPLAY }

        if (preferred != null) return preferred

        val allSecondary = manager.displays
            .filter { it.displayId != Display.DEFAULT_DISPLAY }

        if (allSecondary.isNotEmpty()) {
            return allSecondary.first()
        }

        return null
    }

    private fun missingDisplayMessage(requestedMode: String): String {
        return when (requestedMode) {
            "ANDROID_SECONDARY" -> "No detectamos una pantalla secundaria Android disponible. Este equipo debe exponer un display secundario real para el visor integrado."
            "USB" -> "No detectamos una pantalla secundaria USB / DisplayLink disponible."
            "HDMI" -> "No detectamos una pantalla secundaria HDMI disponible."
            else -> "No detectamos una pantalla secundaria disponible para el visor del cliente."
        }
    }

    private fun dismissActivePresentation() {
        activePresentation?.dismiss()
        activePresentation = null
    }

    private fun failure(message: String): String =
        JSONObject().put("success", false).put("message", message).toString()

    class CustomerDisplayPresentation(
        context: Context,
        display: Display,
        private val targetUrl: String
    ) : Presentation(context, display) {
        private var webView: WebView? = null

        override fun onCreate(savedInstanceState: android.os.Bundle?) {
            super.onCreate(savedInstanceState)

            val container = FrameLayout(context)
            val web = WebView(context)
            configureWebView(web)
            container.addView(
                web,
                FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
            )
            setContentView(container)
            webView = web
            web.loadUrl(targetUrl)
        }

        override fun onStop() {
            super.onStop()
            webView?.stopLoading()
            webView?.destroy()
            webView = null
        }

        private fun configureWebView(webView: WebView) {
            val settings = webView.settings
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            settings.builtInZoomControls = false
            settings.displayZoomControls = false
            settings.setSupportZoom(false)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            }
            webView.isHorizontalScrollBarEnabled = false
            webView.isVerticalScrollBarEnabled = false
        }
    }
}
