package com.clicpos.app;

import android.app.Activity;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import android.os.Trace;
import android.util.Log;
import android.view.FrameMetrics;
import android.webkit.JavascriptInterface;
import org.json.JSONArray;
import org.json.JSONObject;

/** Only available in an explicitly built diagnostic APK and explicitly enabled launch. */
public final class PosNativeDiagnostics {
    private final boolean active;
    private Handler eventWriter;
    private final java.util.concurrent.atomic.AtomicInteger pendingBytes = new java.util.concurrent.atomic.AtomicInteger();
    public PosNativeDiagnostics(Activity activity) {
        active=BuildConfig.POS_DIAGNOSTICS && activity.getIntent().getBooleanExtra("pos_diagnostics",false);
        if(!active)return;
        HandlerThread eventThread=new HandlerThread("PosDiagnosticLogWriter");eventThread.start();eventWriter=new Handler(eventThread.getLooper());
        try {Class.forName("com.getcapacitor.PosDiagnosticHooks").getField("enabled").setBoolean(null,true);}catch(Exception e){Log.e("POS_DIAG_NATIVE","nativeHooksUnavailable");}
        if(Build.VERSION.SDK_INT>=24){
            HandlerThread worker=new HandlerThread("PosDiagnosticFrames");worker.start();
            activity.getWindow().addOnFrameMetricsAvailableListener((window,metrics,dropped)->{
                try {double total=metrics.getMetric(FrameMetrics.TOTAL_DURATION)/1e6;
                    if(total<16.7 && dropped==0)return;
                    JSONObject j=new JSONObject();j.put("name","ANDROID_FRAME");j.put("bootNs",SystemClock.elapsedRealtimeNanos());j.put("intendedVsyncNs",metrics.getMetric(FrameMetrics.INTENDED_VSYNC_TIMESTAMP));j.put("vsyncNs",metrics.getMetric(FrameMetrics.VSYNC_TIMESTAMP));j.put("durationMs",total);j.put("inputMs",metrics.getMetric(FrameMetrics.INPUT_HANDLING_DURATION)/1e6);j.put("layoutMs",metrics.getMetric(FrameMetrics.LAYOUT_MEASURE_DURATION)/1e6);j.put("drawMs",metrics.getMetric(FrameMetrics.DRAW_DURATION)/1e6);j.put("syncMs",metrics.getMetric(FrameMetrics.SYNC_DURATION)/1e6);j.put("commandMs",metrics.getMetric(FrameMetrics.COMMAND_ISSUE_DURATION)/1e6);j.put("swapMs",metrics.getMetric(FrameMetrics.SWAP_BUFFERS_DURATION)/1e6);j.put("droppedReports",dropped);j.put("over32",total>32);j.put("over50",total>50);j.put("over100",total>100);if(Build.VERSION.SDK_INT>=31)j.put("gpuMs",metrics.getMetric(FrameMetrics.GPU_DURATION)/1e6);Log.i("POS_DIAG_FRAME",j.toString());
                }catch(Exception ignored){}
            },new Handler(worker.getLooper()));
        }
    }
    @JavascriptInterface public boolean enabled(){return active;}
    @JavascriptInterface public String clock(){return String.valueOf(SystemClock.elapsedRealtimeNanos());}
    @JavascriptInterface public void section(String id,String operation,boolean begin){
        if(!active||!id.matches("POS-[0-9]{6,}"))return;String name=id+"|ACTION|"+operation.replaceAll("[^a-zA-Z0-9_.:/-]","_");name=name.substring(0,Math.min(120,name.length()));int cookie=id.hashCode();if(Build.VERSION.SDK_INT>=29){if(begin)Trace.beginAsyncSection(name,cookie);else Trace.endAsyncSection(name,cookie);}
    }
    @JavascriptInterface public void events(String json){
        if(!active||json.length()>2000000)return;
        int bytes=json.length();
        if(pendingBytes.addAndGet(bytes)>4000000){pendingBytes.addAndGet(-bytes);Log.w("POS_DIAG_NATIVE","{\"name\":\"DIAGNOSTIC_LOG_DROP\"}");return;}
        eventWriter.post(()->{
            try{JSONArray batch=new JSONArray(json);for(int i=0;i<batch.length();i++)Log.i("POS_DIAG_JS",batch.getJSONObject(i).toString());}catch(Exception ignored){}finally{pendingBytes.addAndGet(-bytes);}
        });
    }
}
