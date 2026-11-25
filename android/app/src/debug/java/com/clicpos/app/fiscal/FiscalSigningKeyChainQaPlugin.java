package com.clicpos.app.fiscal;

import android.app.Activity;
import android.net.Uri;
import android.security.KeyChain;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.security.cert.CertificateException;
import java.util.concurrent.atomic.AtomicReference;

@CapacitorPlugin(name = "FiscalSigningKeyChainQa")
public final class FiscalSigningKeyChainQaPlugin extends Plugin {
    private final AtomicReference<PluginCall> active = new AtomicReference<>();

    @PluginMethod
    public void verify(PluginCall call) {
        String fingerprint = call.getString("certificateSha256");
        if (fingerprint == null || !fingerprint.matches("[a-f0-9]{64}")) {
            call.reject("FISCAL_SIGNING_CERTIFICATE_AUTHORITY_REQUIRED");
            return;
        }
        if (!active.compareAndSet(null, call)) {
            call.reject("FISCAL_SIGNING_CERTIFICATE_SELECTION_ACTIVE");
            return;
        }

        byte[] approved = new byte[32];
        for (int i = 0; i < approved.length; i++) {
            approved[i] = (byte) Integer.parseInt(fingerprint.substring(i * 2, i * 2 + 2), 16);
        }

        Activity activity = getActivity();
        if (activity == null) {
            reject(call, "FISCAL_SIGNING_KEYCHAIN_UNAVAILABLE");
            return;
        }
        activity.runOnUiThread(() -> {
            if (active.get() != call) return;
            if (activity.isFinishing() || activity.isDestroyed()) {
                reject(call, "FISCAL_SIGNING_KEYCHAIN_UNAVAILABLE");
                return;
            }
            try {
                KeyChain.choosePrivateKeyAlias(activity,
                        alias -> execute(() -> verifySelection(call, alias, approved)),
                        new String[]{"RSA"}, null, (Uri) null, null);
            } catch (RuntimeException unavailable) {
                reject(call, "FISCAL_SIGNING_KEYCHAIN_UNAVAILABLE");
            }
        });
    }

    private void verifySelection(PluginCall call, String alias, byte[] approved) {
        if (active.get() != call) return;
        if (alias == null || alias.trim().isEmpty()) {
            reject(call, "FISCAL_SIGNING_CERTIFICATE_NOT_SELECTED");
            return;
        }

        try {
            FiscalXmlSignerQa.open(getContext(), alias, approved).verifyKeyAccess();
        } catch (CertificateException invalid) {
            reject(call, "FISCAL_SIGNING_CERTIFICATE_INVALID");
            return;
        } catch (IllegalStateException invalid) {
            String reason = invalid.getMessage();
            reject(call, "FISCAL_SIGNING_CERTIFICATE_FINGERPRINT_MISMATCH".equals(reason)
                    ? reason : "FISCAL_SIGNING_KEYCHAIN_UNAVAILABLE");
            return;
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            reject(call, "FISCAL_SIGNING_KEYCHAIN_UNAVAILABLE");
            return;
        } catch (Exception unavailable) {
            reject(call, "FISCAL_SIGNING_KEYCHAIN_UNAVAILABLE");
            return;
        }
        if (active.compareAndSet(call, null)) {
            JSObject result = new JSObject();
            result.put("verified", true);
            call.resolve(result);
        }
    }

    private void reject(PluginCall call, String code) {
        if (active.compareAndSet(call, null)) call.reject(code);
    }

    @Override
    protected void handleOnDestroy() {
        PluginCall call = active.getAndSet(null);
        if (call != null) call.release(getBridge());
    }
}
