package com.clicpos.app;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
@CapacitorPlugin(name="PosDiagnosticSink")
public class PosDiagnosticSink extends Plugin {
    @PluginMethod public void send(PluginCall call) {
        PosNativeDiagnostics target=PosNativeDiagnostics.current;
        if(target!=null)target.events(call.getString("payload","[]"));
        call.resolve();
    }
}
