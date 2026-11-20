import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmCurrentAuthorization, paidReturnAuthorizationKey } from '../utils/supervisorAuthorizationGuard';

for(const mode of ['SELF','SUPERVISOR'])for(const change of ['logout','unmount','user','roles','security','attempt','request'])test(`${mode} cannot execute after ${change} during the final asynchronous permission read`,async()=>{
    const original={user:{id:'cashier'},roles:{revision:1},security:{revision:1},attempt:1,request:{id:1}};
    const live={...original,mounted:true};
    const isCurrent=()=>live.mounted&&live.user===original.user&&live.roles===original.roles&&live.security===original.security&&live.attempt===original.attempt&&(mode==='SELF'||live.request===original.request);
    let finish!:(value:{allowed:boolean})=>void;let started=false,callbacks=0;
    const pending=confirmCurrentAuthorization({isCurrent,readFinalContext:()=>{started=true;return new Promise<{allowed:boolean}>(resolve=>{finish=resolve;});},acceptsFinalContext:context=>context.allowed});
    assert.equal(started,true);
    if(change==='logout')live.user=null as any;
    if(change==='unmount')live.mounted=false;
    if(change==='user')live.user={id:'other'};
    if(change==='roles')live.roles={revision:2};
    if(change==='security')live.security={revision:2};
    if(change==='attempt')live.attempt=2;
    if(change==='request'){live.request={id:2};if(mode==='SELF')live.attempt=2;}
    finish({allowed:true});
    const confirmed=await pending;if(confirmed&&isCurrent())callbacks++;
    assert.equal(confirmed,false);assert.equal(callbacks,0);
});
test('unchanged final permission context confirms, denied or stale input never confirms',async()=>{
    assert.equal(await confirmCurrentAuthorization({isCurrent:()=>true,readFinalContext:async()=>({allowed:true}),acceptsFinalContext:c=>c.allowed}),true);
    assert.equal(await confirmCurrentAuthorization({isCurrent:()=>true,readFinalContext:async()=>({allowed:false}),acceptsFinalContext:c=>c.allowed}),false);
    let reads=0;assert.equal(await confirmCurrentAuthorization({isCurrent:()=>false,readFinalContext:async()=>{reads++;return true;}}),false);assert.equal(reads,0);
});

test('paid return survives an equivalent role refresh but blocks changes in terminal, cashier, permission or PIN policy', async () => {
    const user = { id: 'cashier', name: 'Caja', pin: '', role: 'cashier', roleId: 'cashier' };
    const roles = [{ id: 'supervisor', name: 'Supervisor', permissions: ['POS_VOID_PAID_TICKET'] }] as const;
    const snapshot = roles.map(role => ({ ...role, permissions: [...role.permissions] }));
    const security = { deviceBindingToken: 'binding', requirePinForVoid: false, requirePinForDiscount: false,
        requireManagerForRefunds: false, autoLogoutMinutes: 0 };
    const key = paidReturnAuthorizationKey('caja', user, snapshot, security);
    let live = key;
    const approve = () => confirmCurrentAuthorization({ isCurrent: () => live === key });
    live = paidReturnAuthorizationKey('caja', { ...user }, structuredClone(snapshot), { ...security, requirePinForDiscount: true });
    assert.equal(await approve(), true);
    for (const changed of [
        paidReturnAuthorizationKey('otra-caja', user, snapshot, security),
        paidReturnAuthorizationKey('caja', null, snapshot, security),
        paidReturnAuthorizationKey('caja', { ...user, roleId: 'otro' }, snapshot, security),
        paidReturnAuthorizationKey('caja', user, [{ ...snapshot[0], permissions: [] }], security),
        paidReturnAuthorizationKey('caja', user, snapshot, { ...security, requirePinForVoid: true }),
        paidReturnAuthorizationKey('caja', user, snapshot, { ...security, deviceBindingToken: 'other' }),
    ]) {
        live = changed;
        assert.equal(await approve(), false);
    }
});
