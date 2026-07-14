package com.clicpos.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.clicpos.customerdisplay.AndroidCustomerDisplayBridge;
import com.clicpos.nativeprinter.AndroidPrinterBridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {
    private static final int BLUETOOTH_PERMISSION_REQUEST = 2001;
    private static final String TAG = "CLICPOS_MAIN";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        enforcePosWindowPolicy();

        if (getBridge() == null || getBridge().getWebView() == null) {
            return;
        }

        WebView webView = getBridge().getWebView();
        WebSettings settings = webView.getSettings();

        settings.setTextZoom(100);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        webView.addJavascriptInterface(new AndroidPrinterBridge(getApplicationContext()), "AndroidPrinter");
        AndroidPrinterBridge.injectContractShim(webView);
        webView.addJavascriptInterface(
                new AndroidCustomerDisplayBridge(this),
                "AndroidCustomerDisplay"
        );
        webView.addJavascriptInterface(new AndroidAppBridge(), "ClicPOSAppBridge");
        AndroidCustomerDisplayBridge.injectContractShim(webView);
        webView.setInitialScale(0);
        webView.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        installWebViewRenderCrashGuard();

        ensureBluetoothPermissions();
    }

    @Override
    public void onResume() {
        super.onResume();
        enforcePosWindowPolicy();
    }

    private void enforcePosWindowPolicy() {
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        int softInputMode = WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            softInputMode |= WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING;
        } else {
            softInputMode |= WindowManager.LayoutParams.SOFT_INPUT_ADJUST_PAN;
        }
        getWindow().setSoftInputMode(softInputMode);
    }

    private void installWebViewRenderCrashGuard() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getBridge() == null) {
            return;
        }

        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                boolean didCrash = detail != null && detail.didCrash();
                int priority = detail != null ? detail.rendererPriorityAtExit() : -1;
                Log.e(TAG, "WebView renderer gone. handled=true didCrash=" + didCrash + " priority=" + priority);

                runOnUiThread(() -> {
                    try {
                        if (webView != null) {
                            webView.stopLoading();
                        }
                    } catch (Exception ignored) {
                        // The renderer is already gone; best effort only.
                    }
                    recreate();
                });

                return true;
            }
        });
    }

    private class AndroidAppBridge {
        @JavascriptInterface
        public void exitApp() {
            runOnUiThread(() -> {
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        finishAndRemoveTask();
                    } else {
                        finish();
                    }
                } catch (Exception error) {
                    Log.e(TAG, "Failed to exit app from androidBridge", error);
                    finish();
                }
            });
        }
    }

    private void ensureBluetoothPermissions() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            return;
        }

        String[] requiredPermissions = new String[] {
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_CONNECT
        };

        List<String> missingPermissions = new ArrayList<>();
        for (String permission : requiredPermissions) {
            if (ContextCompat.checkSelfPermission(this, permission) != PackageManager.PERMISSION_GRANTED) {
                missingPermissions.add(permission);
            }
        }

        if (!missingPermissions.isEmpty()) {
            ActivityCompat.requestPermissions(
                    this,
                    missingPermissions.toArray(new String[0]),
                    BLUETOOTH_PERMISSION_REQUEST
            );
        }
    }
}
