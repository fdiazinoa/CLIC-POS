import { readTerminalCredentialsSync, buildTerminalSyncAuthHeaders } from './sync/TerminalCredentialStore';
import { DiagnosticDeliveryWorker, type DeliveryRow, type DeliveryState, type DeliveryContext } from './CheckoutDiagnosticDelivery';

const request = <T>(r: IDBRequest<T>) => new Promise<T>((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
export const deliveryStatus = async (db: IDBDatabase) => {
    const tx=db.transaction(['delivery','deliveryState']);
    const [rows,states]=await Promise.all([request(tx.objectStore('delivery').getAll()),request(tx.objectStore('deliveryState').getAll())]);
    const latest=(states as DeliveryState[]).filter(s=>s.lastAckAt).sort((a,b)=>String(b.lastAckAt).localeCompare(String(a.lastAckAt)))[0];
    return {pending:rows.length,blocked:rows.filter((r:DeliveryRow)=>states.some((s:DeliveryState)=>s.id===r.session.id&&s.blocked)).length,lastAckAt:latest?.lastAckAt||null,lastError:states.find((s:DeliveryState)=>s.lastError)?.lastError||null};
};
export function createDiagnosticTransport(open:()=>Promise<IDBDatabase>) {
    return new DiagnosticDeliveryWorker({
        rows:async()=>request((await open()).transaction('delivery').objectStore('delivery').getAll()) as Promise<DeliveryRow[]>,
        state:async id=>(await request((await open()).transaction('deliveryState').objectStore('deliveryState').get(id)))||{id},
        save:async state=>{
            const db=await open();await new Promise<void>((resolve,reject)=>{const tx=db.transaction('deliveryState','readwrite');tx.objectStore('deliveryState').put(state);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);});
        },
        acknowledge:async(rows,ids,state)=>{
            const db=await open();await new Promise<void>((resolve,reject)=>{
                const tx=db.transaction(['delivery','deliveryState'],'readwrite');
                rows.filter(r=>ids.includes(r.event.record_id)).forEach(r=>tx.objectStore('delivery').delete(r.sequence!));
                tx.objectStore('deliveryState').put(state);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);
            });
        },
        context:async()=>{
            const c=readTerminalCredentialsSync();
            const raw=localStorage.getItem('CLIC_ERP_SYNC_URL')||localStorage.getItem('CLIC_ERP_BASE_URL');
            if (!raw || !c.erpTerminalId || !c.deviceId || !buildTerminalSyncAuthHeaders()['X-Sync-Token']) return null;
            const url=new URL(raw); if(url.protocol!=='https:') return null;
            const base=url.origin+url.pathname.replace(/\/+$/,'').replace(/\/api(?:\/sync)?$/,'')+'/api/sync';
            return {base,terminalId:c.erpTerminalId,deviceId:c.deviceId,headers:{...buildTerminalSyncAuthHeaders(),'X-Terminal-Id':c.erpTerminalId,'X-Device-Id':c.deviceId,'Content-Type':'application/json'}} as DeliveryContext;
        },
        post:async(context,path,body)=>{
            const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),8000);
            try {
                const response=await fetch(context.base+path,{method:'POST',headers:context.headers,body:JSON.stringify(body),signal:controller.signal});
                const data=await response.json().catch(()=>({}));
                const retry=response.headers.get('Retry-After');
                return {status:response.status,data,retryAfterMs:retry?(Number.isFinite(Number(retry))?Number(retry)*1000:Math.max(0,Date.parse(retry)-Date.now())):0};
            } finally { clearTimeout(timer); }
        },
    });
}
