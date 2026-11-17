import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { IDBFactory } from 'fake-indexeddb';

// Render the real hook to capture callbacks; use real IndexedDB persistence.
// This tests decisions/async cancellation, not DOM interaction or Android UI.
test('real authorization hook captures self/supervisor once and honors cancellation during local persistence', async () => {
    const values=new Map<string,string>();const prior=new Map(['window','localStorage','indexedDB'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
    Object.defineProperties(globalThis,{window:{configurable:true,value:{setTimeout,clearTimeout,alert:()=>undefined}},localStorage:{configurable:true,value:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)}},indexedDB:{configurable:true,value:new IDBFactory()}});
    let database:any;
    try {
        const [{useSupervisorAuth},{dbAdapter},{permissionService}]=await Promise.all([import('../hooks/useSupervisorAuth'),import('../services/db'),import('../services/sync/PermissionService')]);
        database=dbAdapter;await database.connect();
        const cashier={id:'cashier',name:'Cajero',pin:'1234',role:'cashier',roleId:'cashier',isActive:true} as any;
        const supervisor={id:'supervisor',name:'Supervisor',pin:'5678',role:'supervisor',isActive:true} as any;
        const config={id:'current',terminals:[{id:'POS-1',config:{}}],auditLogs:[]} as any;permissionService.initialize(config,'POS-1');
        let hook:ReturnType<typeof useSupervisorAuth>;let applied=0;let cancel=false;
        const render=(permissions:string[])=>{const roles=[{id:'cashier',name:'Cashier',permissions,maxDiscountPercent:20}] as any;function Component(){hook=useSupervisorAuth({config,currentUser:cashier,roles,onUpdateConfig:newConfig=>{config.auditLogs=newConfig.auditLogs;if(cancel)hook.supervisorModalProps.onClose();}});return null;}renderToString(React.createElement(Component));};
        render(['POS_DISCOUNT']);
        assert.equal(await hook!.requestApproval({permission:'POS_DISCOUNT',actionDescription:'Descuento',context:{newValue:10},onAuthorized:()=>applied++}),true);
        assert.equal(applied,1);
        let rows=await database.getCollection('posAuditEvents');assert.equal(rows.length,1);assert.equal(rows[0].event.cashierId,rows[0].event.supervisorId);
        render([]);cancel=true;
        const canceled=hook!.requestApproval({permission:'POS_DISCOUNT',actionDescription:'Descuento cancelado',onAuthorized:()=>applied++});
        await hook!.supervisorModalProps.onAuthorize(supervisor);
        assert.equal(await canceled,false);assert.equal(applied,1);
        rows=await database.getCollection('posAuditEvents');assert.equal(rows.length,2);assert.equal(rows.find((row:any)=>row.event.actionDescription==='Descuento cancelado').event.supervisorId,'supervisor');
        cancel=false;render([]);
        const approved=hook!.requestApproval({permission:'POS_DISCOUNT',actionDescription:'Una autorización',onAuthorized:()=>applied++});
        await Promise.all([hook!.supervisorModalProps.onAuthorize(supervisor),hook!.supervisorModalProps.onAuthorize(supervisor)]);
        assert.equal(await approved,true);assert.equal(applied,2);assert.equal((await database.getCollection('posAuditEvents')).length,3);
    }finally{await database?.disconnect();for(const[key,descriptor]of prior){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete(globalThis as any)[key];}}
});
