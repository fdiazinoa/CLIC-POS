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
public class ZebraScannerPlugin extends Plugin implements IDcsSdkApiDelegate {
    private SDKHandler sdk;
    private volatile int scannerId = -1;
    private volatile boolean enabled;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void start(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                if (sdk == null) {
                    sdk = new SDKHandler(getActivity(), true, false);
                    sdk.dcssdkSetDelegate(this);
                    sdk.dcssdkSetOperationalMode(DCSSDKDefs.DCSSDK_MODE.DCSSDK_OPMODE_SNAPI);
                    sdk.dcssdkSubsribeForEvents(
                        DCSSDKDefs.DCSSDK_EVENT.DCSSDK_EVENT_SCANNER_APPEARANCE.value |
                        DCSSDKDefs.DCSSDK_EVENT.DCSSDK_EVENT_SCANNER_DISAPPEARANCE.value |
                        DCSSDKDefs.DCSSDK_EVENT.DCSSDK_EVENT_SESSION_ESTABLISHMENT.value |
                        DCSSDKDefs.DCSSDK_EVENT.DCSSDK_EVENT_SESSION_TERMINATION.value |
                        DCSSDKDefs.DCSSDK_EVENT.DCSSDK_EVENT_BARCODE.value);
                }
                enabled = true;
                sdk.dcssdkEnableAvailableScannersDetection(true);
                worker.execute(() -> {
                    try {
                        for (DCSScannerInfo info : sdk.dcssdkGetAvailableScannersList()) connect(info);
                        call.resolve();
                    } catch (Exception e) { call.reject("No se pudo conectar el lector Zebra", e); }
                });
            } catch (Exception e) { call.reject("No se pudo iniciar el SDK Zebra", e); }
        });
    }

    private void connect(DCSScannerInfo info) {
        if (enabled && scannerId < 0) sdk.dcssdkEstablishCommunicationSession(info.getScannerID());
    }

    @PluginMethod
    public void stop(PluginCall call) {
        enabled = false;
        worker.execute(() -> {
            try {
                if (sdk != null) {
                    sdk.dcssdkEnableAvailableScannersDetection(false);
                    for (DCSScannerInfo info : sdk.dcssdkGetActiveScannersList())
                        sdk.dcssdkTerminateCommunicationSession(info.getScannerID());
                }
                scannerId = -1;
                call.resolve();
            } catch (Exception e) { call.reject("No se pudo desconectar el lector", e); }
        });
    }

    @PluginMethod
    public void readWeight(PluginCall call) {
        worker.execute(() -> {
            int id = scannerId;
            if (!enabled || id < 0) { call.reject("MP7000 desconectado o sin permiso USB"); return; }
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
        });
    }

    @Override public void dcssdkEventScannerAppeared(DCSScannerInfo info) {
        if (enabled) worker.execute(() -> connect(info));
    }
    @Override public void dcssdkEventCommunicationSessionEstablished(DCSScannerInfo info) {
        if (!enabled) return;
        scannerId = info.getScannerID();
        JSObject event = new JSObject();
        event.put("connected", true);
        event.put("model", info.getScannerModel());
        notifyListeners("connection", event);
    }
    @Override public void dcssdkEventCommunicationSessionTerminated(int id) {
        if (scannerId != id) return;
        scannerId = -1;
        JSObject event = new JSObject(); event.put("connected", false);
        notifyListeners("connection", event);
    }
    @Override public void dcssdkEventScannerDisappeared(int id) { dcssdkEventCommunicationSessionTerminated(id); }
    @Override public void dcssdkEventBarcode(byte[] data, int type, int id) {
        if (!enabled || id != scannerId) return;
        JSObject event = new JSObject();
        event.put("barcode", new String(data, StandardCharsets.UTF_8));
        notifyListeners("barcode", event);
    }
    @Override protected void handleOnDestroy() {
        enabled = false;
        worker.execute(() -> getActivity().runOnUiThread(() -> {
            if (sdk != null) sdk.dcssdkClose();
        }));
        worker.shutdown();
    }
    @Override public void dcssdkEventImage(byte[] data, int id) {}
    @Override public void dcssdkEventVideo(byte[] data, int id) {}
    @Override public void dcssdkEventBinaryData(byte[] data, int id) {}
    @Override public void dcssdkEventFirmwareUpdate(FirmwareUpdateEvent event) {}
    @Override public void dcssdkEventAuxScannerAppeared(DCSScannerInfo parent, DCSScannerInfo aux) {}
    @Override public void dcssdkEventConfigurationUpdate(ConfigurationUpdateEvent event) {}
}
