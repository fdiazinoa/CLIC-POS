package com.getcapacitor;

import android.os.Looper;
import android.os.Process;
import android.os.SystemClock;
import android.os.Trace;
import android.util.Log;
import org.json.JSONObject;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/** Added only by the diagnostic build script. No payload or SQL bind logging. */
public final class PosDiagnosticHooks {
    public static volatile boolean enabled = false;
    private static final ThreadLocal<PluginCall> active = new ThreadLocal<>();
    private static final ConcurrentHashMap<String, Long> queued = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<Integer, Span> transactions = new ConcurrentHashMap<>();
    private static final AtomicInteger sequence = new AtomicInteger();
    public static class Span {
        final long start; final String id, bridgeId, name, type; final int cookie;
        Span(String type, String name) {this.start=SystemClock.elapsedRealtimeNanos();this.id=id();this.bridgeId=bridgeId();this.name=name;this.type=type;this.cookie=sequence.incrementAndGet();}
    }
    private static String id(){PluginCall c=active.get();return c==null?"UNATTRIBUTED":c.getString("_posTraceId","UNATTRIBUTED");}
    private static String bridgeId(){PluginCall c=active.get();return c==null?"":c.getString("_posSpanId","");}
    private static void event(String id,String name,String op,String sid,long start,long rows,String error){
        if(!enabled)return;
        Trace.beginSection("POS_DIAGNOSTIC_EMIT");
        try {JSONObject j=new JSONObject();j.put("traceId",id);j.put("name",name);j.put("operation",op);j.put("spanId",sid);j.put("bootNs",SystemClock.elapsedRealtimeNanos());j.put("tid",Process.myTid());j.put("pid",Process.myPid());j.put("bridgeSpanId",bridgeId());j.put("thread",Thread.currentThread().getName());j.put("mainThread",Looper.myLooper()==Looper.getMainLooper());
            if(start>0){double duration=(SystemClock.elapsedRealtimeNanos()-start)/1e6;j.put("durationMs",duration);j.put("over25",duration>25);j.put("over50",duration>50);j.put("over100",duration>100);}
            if(rows>=0)j.put("rows",rows);
            if(error!=null){j.put("errorClass",error);j.put("lockError",error.toLowerCase().contains("lock")||error.toLowerCase().contains("busy"));}
            Log.i("POS_DIAG_NATIVE",j.toString());
        }catch(Exception ignored){} finally { Trace.endSection(); }
    }
    public static void enqueue(String plugin,String method,PluginCall call){if(!enabled)return;queued.put(call.getCallbackId(),SystemClock.elapsedRealtimeNanos());PluginCall prior=active.get();active.set(call);event(id(),"BRIDGE_ENQUEUE",plugin+"."+method,bridgeId(),0,-1,null);active.set(prior);}
    public static void enter(String plugin,String method,PluginCall call){if(!enabled)return;active.set(call);Long q=queued.remove(call.getCallbackId());event(id(),"PLUGIN_START",plugin+"."+method,bridgeId(),q==null?0:q,-1,null);Trace.beginSection((id()+"|PLUGIN|"+plugin+"."+method).substring(0,Math.min(120,(id()+"|PLUGIN|"+plugin+"."+method).length())));}
    public static void leave(String plugin,String method,PluginCall call){if(!enabled)return;event(id(),"PLUGIN_RETURN",plugin+"."+method,bridgeId(),0,-1,null);Trace.endSection();active.remove();}
    public static void response(PluginCall call){if(!enabled)return;event(call.getString("_posTraceId","UNATTRIBUTED"),"PLUGIN_RESPONSE",call.getMethodName(),call.getString("_posSpanId",""),0,-1,null);}
    public static String sqlName(String sql){
        if(sql==null)return "unknown";
        // SQL templates only: redact quoted literals, comments, and numbers. Never bindings.
        String normalized = sql.replaceAll("(?s)/\\*.*?\\*/|--[^\\r\\n]*", " ").replaceAll("'(?:''|[^'])*'", "?").replaceAll("\\b\\d+(?:\\.\\d+)?\\b", "?").replaceAll("\\s+", " ").trim();
        return Integer.toHexString(normalized.hashCode()) + ":" + normalized.substring(0,Math.min(700,normalized.length()));
    }
    public static Span begin(String type,String operation){
        if(!enabled)return null;Span s=new Span(type,operation);String name=s.id+"|"+type+"|"+operation;Trace.beginSection(name.substring(0,Math.min(120,name.length())));event(s.id,type+"_START",operation,String.valueOf(s.cookie),0,-1,null);return s;
    }
    public static void end(Span s,long rows,Throwable error){
        if(s==null)return;event(s.id,s.type+"_END",s.name,String.valueOf(s.cookie),s.start,rows,error==null?null:((String.valueOf(error.getMessage()).toLowerCase().contains("locked")||String.valueOf(error.getMessage()).toLowerCase().contains("busy"))?"SQLiteLockError":error.getClass().getSimpleName()));Trace.endSection();
    }
    public static void transactionBegin(Object db){if(!enabled)return;Span s=new Span("SQLITE_TRANSACTION","transaction");transactions.put(System.identityHashCode(db),s);Trace.beginAsyncSection(s.id+"|SQLITE_TRANSACTION",s.cookie);event(s.id,"SQLITE_TRANSACTION_START",s.name,String.valueOf(s.cookie),0,-1,null);}
    public static void transactionEnd(Object db){if(!enabled)return;Span s=transactions.remove(System.identityHashCode(db));if(s==null)return;event(s.id,"SQLITE_TRANSACTION_END",s.name,String.valueOf(s.cookie),s.start,-1,null);Trace.endAsyncSection(s.id+"|SQLITE_TRANSACTION",s.cookie);}
}
