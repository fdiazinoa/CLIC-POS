package com.clicpos.app;

import android.app.ActivityManager;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.PowerManager;
import android.os.StatFs;
import android.util.DisplayMetrics;
import android.view.Display;
import android.webkit.WebView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

/**
 * DCP Tier B: read-only device capability bridge for the shadow profiler.
 *
 * <p>Only public, permission-free Android APIs are queried. This plugin performs no
 * network access, no polling, no disk writes and exposes no personal data. It exists
 * solely to feed the Device Capability Profiler in shadow mode and must never be used
 * on the sale path or to change fiscal/sync behaviour.</p>
 *
 * <p>Every signal is best-effort and optional: when an API is unavailable for the
 * running Android version, or a signal cannot be read, the key is simply omitted and
 * the TypeScript profiler falls back to Tier A.</p>
 *
 * <p>Native cache: per audit 12.3, {@link #getInfo(PluginCall)} is idempotent inside a
 * 60 s window and returns the same captured {@link JSObject} without re-reading the
 * system APIs. No polling, no network, no disk writes: the cache lives only in memory
 * for the lifetime of the bridge.</p>
 */
@CapacitorPlugin(name = "DeviceCapability")
public class DeviceCapabilityPlugin extends Plugin {
    private static final long BYTES_PER_MB = 1024L * 1024L;
    private static final long CACHE_TTL_MS = 60_000L;

    private final Object cacheLock = new Object();
    private JSObject cachedInfo;
    private long cachedInfoCapturedAt;

    @PluginMethod
    public void getInfo(PluginCall call) {
        try {
            synchronized (cacheLock) {
                long now = System.currentTimeMillis();
                if (cachedInfo != null && now - cachedInfoCapturedAt <= CACHE_TTL_MS) {
                    call.resolve(cachedInfo);
                    return;
                }
            }
            JSObject fresh = collect();
            synchronized (cacheLock) {
                cachedInfo = fresh;
                cachedInfoCapturedAt = System.currentTimeMillis();
            }
            call.resolve(fresh);
        } catch (Exception error) {
            call.reject("DEVICE_CAPABILITY_FAILED", error);
        }
    }

    private JSObject collect() {
        JSObject info = new JSObject();
        info.put("capturedAt", System.currentTimeMillis());

        info.put("sdkInt", Build.VERSION.SDK_INT);
        if (Build.VERSION.RELEASE != null) info.put("release", Build.VERSION.RELEASE);
        info.put("cores", Runtime.getRuntime().availableProcessors());
        JSONArray abis = new JSONArray();
        String[] supportedAbis = Build.SUPPORTED_ABIS;
        if (supportedAbis != null) {
            for (String abi : supportedAbis) {
                if (abi != null) abis.put(abi);
            }
        }
        info.put("abis", abis);

        collectMemory(info);
        collectDisplay(info);
        collectPower(info);
        collectStorage(info);
        collectWebView(info);
        collectNetwork(info);
        return info;
    }

    private void collectMemory(JSObject info) {
        ActivityManager manager = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
        if (manager == null) return;
        ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
        manager.getMemoryInfo(memory);
        info.put("totalMemMb", memory.totalMem / BYTES_PER_MB);
        info.put("availMemMb", memory.availMem / BYTES_PER_MB);
        info.put("thresholdMb", memory.threshold / BYTES_PER_MB);
        info.put("lowMemory", memory.lowMemory);
        info.put("memoryClassMb", manager.getMemoryClass());
        info.put("largeMemoryClassMb", manager.getLargeMemoryClass());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            info.put("lowRamDevice", manager.isLowRamDevice());
        }
    }

    private void collectDisplay(JSObject info) {
        DisplayMetrics metrics = getContext().getResources().getDisplayMetrics();
        info.put("densityDpi", metrics.densityDpi);
        info.put("widthPx", metrics.widthPixels);
        info.put("heightPx", metrics.heightPixels);

        Display display = null;
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                display = getBridge().getWebView().getDisplay();
            }
            if (display == null && getActivity() != null) {
                display = getActivity().getWindowManager().getDefaultDisplay();
            }
        } catch (Exception ignored) {
            display = null;
        }
        if (display == null) return;

        try {
            info.put("refreshRateHz", display.getRefreshRate());
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                float maxRefreshRate = 0f;
                for (Display.Mode mode : display.getSupportedModes()) {
                    if (mode != null && mode.getRefreshRate() > maxRefreshRate) {
                        maxRefreshRate = mode.getRefreshRate();
                    }
                }
                if (maxRefreshRate > 0f) info.put("maxRefreshRateHz", maxRefreshRate);
            }
        } catch (Exception ignored) {
            // Refresh rate is optional; the profiler falls back to measured rAF cadence.
        }
    }

    private void collectPower(JSObject info) {
        PowerManager power = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        if (power == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            info.put("powerSaveMode", power.isPowerSaveMode());
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            info.put("deviceIdleMode", power.isDeviceIdleMode());
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            info.put("thermalStatus", power.getCurrentThermalStatus());
        }
    }

    private void collectStorage(JSObject info) {
        try {
            StatFs storage = new StatFs(getContext().getFilesDir().getAbsolutePath());
            info.put("freeStorageMb", storage.getAvailableBytes() / BYTES_PER_MB);
            info.put("totalStorageMb", storage.getTotalBytes() / BYTES_PER_MB);
        } catch (Exception ignored) {
            // Storage is an optional signal; unknown storage keeps the conservative score.
        }
    }

    private void collectWebView(JSObject info) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        try {
            PackageInfo webViewPackage = WebView.getCurrentWebViewPackage();
            if (webViewPackage == null) return;
            if (webViewPackage.packageName != null) info.put("webViewPackage", webViewPackage.packageName);
            if (webViewPackage.versionName != null) info.put("webViewVersion", webViewPackage.versionName);
        } catch (Exception ignored) {
            // WebView package is optional; an unknown version keeps the conservative score.
        }
    }

    private void collectNetwork(JSObject info) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        try {
            ConnectivityManager connectivity =
                    (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            if (connectivity == null) return;
            Network activeNetwork = connectivity.getActiveNetwork();
            if (activeNetwork == null) return;
            NetworkCapabilities capabilities = connectivity.getNetworkCapabilities(activeNetwork);
            if (capabilities == null) return;
            info.put("online", capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET));
            info.put("metered", !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED));
            info.put("vpn", capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN));
        } catch (Exception ignored) {
            // Connectivity hints are optional and never used for behaviour decisions.
        }
    }
}
