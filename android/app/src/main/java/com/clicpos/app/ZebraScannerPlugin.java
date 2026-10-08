package com.clicpos.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.zebra.scannercontrol.*;
import com.zebra.barcode.sdk.sms.ConfigurationUpdateEvent;
import android.util.Xml;
import org.xmlpull.v1.XmlPullParser;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** USB SNAPI only. Started explicitly by the terminal's hardware setting. */
@CapacitorPlugin(name = "ZebraScanner")
public class ZebraScannerPlugin extends Plugin {
    private SDKHandler sdk;
    private volatile int scannerId = -1;
    private volatile boolean enabled;
    private volatile boolean destroyed;
    private volatile long generation;
    private final Object stateLock = new Object();
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    private boolean enqueue(Runnable task) {
        synchronized (stateLock) {
            if (destroyed) return false;
            try { worker.execute(task); return true; }
            catch (java.util.concurrent.RejectedExecutionException ignored) { return false; }
        }
    }

    private void onMainThread(Runnable task) throws Exception {
        java.util.concurrent.FutureTask<Void> future = new java.util.concurrent.FutureTask<>(task, null);
        getActivity().runOnUiThread(future);
        future.get();
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (destroyed) { call.reject("Lector cerrado"); return; }
        if (!enqueue(() -> {
            try {
                if (destroyed) { call.reject("Lector cerrado"); return; }
                if (enabled) { call.resolve(); return; }
                final long epoch;
                synchronized (stateLock) { epoch = ++generation; enabled = true; }
                onMainThread(() -> {
                    sdk = new SDKHandler(getActivity(), true, false);
                    sdk.dcssdkSetDelegate(new SessionDelegate(epoch));
                    sdk.dcssdkSetOperationalMode(DCSSDKDefs.DCSSDK_MODE.DCSSDK_OPMODE_SNAPI);
                    sdk.dcssdkSubsribeForEvents(
                        DCSSDKDefs.DCSSDK_EVENT.DCSSDK_EVENT_SCANNER_APPEARANCE.value |
                        DCSSDKDefs.DCSSDK_EVENT.DCSSDK_EVENT_SCANNER_DISAPPEARANCE.value |
                        DCSSDKDefs.DCSSDK_EVENT.DCSSDK_EVENT_SESSION_ESTABLISHMENT.value |
                        DCSSDKDefs.DCSSDK_EVENT.DCSSDK_EVENT_SESSION_TERMINATION.value |
                        DCSSDKDefs.DCSSDK_EVENT.DCSSDK_EVENT_BARCODE.value);
                    sdk.dcssdkEnableAvailableScannersDetection(true);
                });
                for (DCSScannerInfo info : sdk.dcssdkGetAvailableScannersList()) connect(info, epoch);
                call.resolve();
            } catch (Exception e) {
                try { closeSession(); } catch (Exception ignored) {}
                call.reject("No se pudo iniciar el SDK Zebra", e);
            }
        })) call.reject("Lector cerrado");
    }

    private void connect(DCSScannerInfo info, long epoch) {
        if (!destroyed && enabled && generation == epoch && scannerId < 0)
            sdk.dcssdkEstablishCommunicationSession(info.getScannerID());
    }

    private void closeSession() throws Exception {
        synchronized (stateLock) { enabled = false; generation++; scannerId = -1; }
        SDKHandler closing = sdk;
        sdk = null;
        if (closing != null) onMainThread(() -> {
            closing.dcssdkEnableAvailableScannersDetection(false);
            closing.dcssdkClose();
        });
        JSObject event = new JSObject(); event.put("connected", false);
        notifyListeners("connection", event);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (destroyed) { call.reject("Lector cerrado"); return; }
        if (!enqueue(() -> {
            try { closeSession(); call.resolve(); }
            catch (Exception e) { call.reject("No se pudo desconectar el lector", e); }
        })) call.reject("Lector cerrado");
    }

    @PluginMethod
    public void readWeight(PluginCall call) {
        if (!enqueue(() -> {
            int id = scannerId;
            if (destroyed || !enabled || id < 0) { call.reject("MP7000 desconectado o sin permiso USB"); return; }
            try {
                StringBuilder output = new StringBuilder();
                DCSSDKDefs.DCSSDK_RESULT result = sdk.dcssdkExecuteCommandOpCodeInXMLForScanner(
                    DCSSDKDefs.DCSSDK_COMMAND_OPCODE.DCSSDK_READ_WEIGHT,
                    "<inArgs><scannerID>" + id + "</scannerID></inArgs>", output, id);
                if (result != DCSSDKDefs.DCSSDK_RESULT.DCSSDK_RESULT_SUCCESS)
                    throw new IllegalStateException("No se pudo leer la báscula: " + result);
                if (!enabled || scannerId != id) throw new IllegalStateException("MP7000 desconectado");
                XmlPullParser parser = Xml.newPullParser();
                parser.setInput(new StringReader(output.toString()));
                JSObject reading = new JSObject();
                while (parser.next() != XmlPullParser.END_DOCUMENT) {
                    if (parser.getEventType() != XmlPullParser.START_TAG) continue;
                    String tag = parser.getName();
                    if (tag.equals("weight") || tag.equals("weight_mode") || tag.equals("status"))
                        reading.put(tag, parser.nextText().trim());
                }
                call.resolve(reading);
            } catch (Exception e) { call.reject(e.getMessage(), e); }
        })) call.reject("Lector cerrado");
    }

    /** A new delegate per SDK session rejects callbacks from previous enable cycles. */
    private final class SessionDelegate implements IDcsSdkApiDelegate {
        private final long epoch;
        SessionDelegate(long epoch) { this.epoch = epoch; }
        private boolean current() { return !destroyed && enabled && generation == epoch; }
        @Override public void dcssdkEventScannerAppeared(DCSScannerInfo info) {
            if (current()) enqueue(() -> connect(info, epoch));
        }
        @Override public void dcssdkEventCommunicationSessionEstablished(DCSScannerInfo info) {
            synchronized (stateLock) {
                if (!current()) return;
                scannerId = info.getScannerID();
                JSObject event = new JSObject(); event.put("connected", true);
                event.put("model", info.getScannerModel());
                notifyListeners("connection", event);
            }
        }
        @Override public void dcssdkEventCommunicationSessionTerminated(int id) {
            synchronized (stateLock) {
                if (!current() || scannerId != id) return;
                scannerId = -1;
                JSObject event = new JSObject(); event.put("connected", false);
                notifyListeners("connection", event);
            }
        }
        @Override public void dcssdkEventScannerDisappeared(int id) { dcssdkEventCommunicationSessionTerminated(id); }
        @Override public void dcssdkEventBarcode(byte[] data, int type, int id) {
            synchronized (stateLock) {
                if (!current() || id != scannerId) return;
                JSObject event = new JSObject();
                event.put("barcode", new String(data, StandardCharsets.UTF_8));
                notifyListeners("barcode", event);
            }
        }
        @Override public void dcssdkEventImage(byte[] data, int id) {}
        @Override public void dcssdkEventVideo(byte[] data, int id) {}
        @Override public void dcssdkEventBinaryData(byte[] data, int id) {}
        @Override public void dcssdkEventFirmwareUpdate(FirmwareUpdateEvent event) {}
        @Override public void dcssdkEventAuxScannerAppeared(DCSScannerInfo parent, DCSScannerInfo aux) {}
        @Override public void dcssdkEventConfigurationUpdate(ConfigurationUpdateEvent event) {}
    }
    @Override protected void handleOnDestroy() {
        synchronized (stateLock) {
            if (destroyed) return;
            destroyed = true; enabled = false; generation++; scannerId = -1;
            worker.execute(() -> {
                try { closeSession(); } catch (Exception ignored) {}
            });
            worker.shutdown();
        }
    }
}
