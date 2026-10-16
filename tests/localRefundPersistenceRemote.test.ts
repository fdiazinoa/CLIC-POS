import assert from 'node:assert/strict';
import test from 'node:test';
import type { CartItem, Transaction } from '../types';
import { db } from '../utils/db';
import { backgroundSyncManager } from '../services/sync/BackgroundSyncManager';
import { persistStandaloneRefundTransaction } from '../services/localRefundPersistence';
import { reconcilePreparedFiscalCollections } from '../utils/fiscalPreparedAuthority';

const item: CartItem = {
  id: 'product-1',
  cartId: 'line-1',
  name: 'Artículo',
  price: 100,
  quantity: 1,
} as CartItem;

test('persists only the NC when its source was consulted in ERP', async () => {
  const original: Transaction = {
    id: 'remote-sale',
    displayId: 'TCK-REMOTE',
    date: '2026-09-08T12:00:00.000Z',
    items: [item],
    total: 100,
    payments: [],
    userId: 'u1',
    userName: 'User',
    terminalId: 'terminal-old',
    status: 'COMPLETED',
  };
  const refund: Transaction = {
    ...original,
    id: 'credit-note',
    displayId: 'NC-1',
    documentType: 'REFUND',
    originalTransactionId: original.id,
    terminalId: 'terminal-current',
    status: 'REFUNDED',
  };

  const saved: Array<{ collection: string; id: string }> = [];
  const originalSaveDocument = db.saveDocument;
  const originalRecordInventoryMovement = db.recordInventoryMovement;
  const originalTriggerSync = backgroundSyncManager.triggerSync;
  const originalWindow = globalThis.window;
  try {
    db.saveDocument = async (collection: string, document: any) => {
      saved.push({ collection, id: document.id });
    };
    db.recordInventoryMovement = async () => undefined as any;
    backgroundSyncManager.triggerSync = async () => undefined;
    Object.assign(globalThis, { window: { dispatchEvent: () => true } });

    const result = await persistStandaloneRefundTransaction(refund, {
      warehouseId: 'warehouse',
      terminalId: 'terminal-current',
      originalTransaction: original,
      persistOriginal: false,
      conditions: new Map([['line-1', 'SELLABLE']]),
    });

    assert.equal(result.updatedOriginal, undefined);
    assert.deepEqual(saved, [
      { collection: 'transactions', id: 'credit-note' },
      { collection: 'transactionHistory', id: 'credit-note' },
    ]);
    await new Promise(resolve => setTimeout(resolve, 25));
  } finally {
    db.saveDocument = originalSaveDocument;
    db.recordInventoryMovement = originalRecordInventoryMovement;
    backgroundSyncManager.triggerSync = originalTriggerSync;
    Object.assign(globalThis, { window: originalWindow });
  }
});

test('advances local fiscal state to the B04 reserved by ERP without moving backward', async () => {
  const allocations: any[] = [{
      id: 'allocation', terminalId: 'terminal-current', fiscalRangeId: 'range', ncfType: 'B04',
      reservedStart: 1, reservedEnd: 100, nextNumber: 1, status: 'ACTIVE', releasedAt: null,
    }];
  const buffers: any[] = [{
      id: 'buffer', type: 'B04', prefix: 'B04', startNumber: 1, currentNumber: 1,
      endNumber: 100, expiryDate: '2099-12-31', terminalId: 'terminal-current', allocationId: 'allocation',
    }];
  const first = reconcilePreparedFiscalCollections(allocations, buffers, 'B04', 'terminal-current', 'B0400000007');
  assert.equal(first.allocations[0].nextNumber, 8);
  assert.equal(first.buffers[0].currentNumber, 8);
  const second = reconcilePreparedFiscalCollections(first.allocations, first.buffers, 'B04', 'terminal-current', 'B0400000004');
  assert.equal(second.allocations[0].nextNumber, 8);
  assert.equal(second.buffers[0].currentNumber, 8);
});

test('fresh partial refund during approval cannot silently rebase captured commercial version or write a second refund',async()=>{
 const {nativeFixture}=await import('./articleFormatsNativeFixture');
 const {readRefundOriginal}=await import('../services/localRefundPersistence');
 const f=await nativeFixture();const get=db.getDocument;
 try{
  const binding=(f.db.prepare('SELECT binding FROM master_v3_operational_owner').get() as any).binding;
  const original:any={id:'source',status:'COMPLETED',items:[{...item,quantity:10,v3SaleAuthority:{binding}}],relatedTransactions:[],v3Binding:binding,v3InventoryBaseline:'baseline',total:1000};
  const fresh={...original,status:'PARTIAL_REFUND',relatedTransactions:['already-refunded-4']};
  for(const collection of ['transactions','transactionHistory'])f.db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)').run(collection,'source',JSON.stringify(fresh),0,'now');
  f.db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)').run('transactions','already-refunded-4',JSON.stringify({id:'already-refunded-4',documentType:'REFUND',originalTransactionId:'source',items:[{...item,quantity:4}],total:400}),0,'now');
  f.db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)').run('inventoryLedger','first-refund-ledger',JSON.stringify({id:'first-refund-ledger',qtyIn:4,qtyOut:0}),0,'now');
  const before=f.state();db.getDocument=(async(name:string,id:string)=>name==='config'?{id:'current'}:f.adapter.getDocument(name,id)) as any;
  await assert.rejects(()=>readRefundOriginal(original),/ORIGINAL_CHANGED/);
  await assert.rejects(()=>persistStandaloneRefundTransaction({...original,id:'second-refund-8',documentType:'REFUND',total:800,items:[{...original.items[0],quantity:8}]} as any,
   {warehouseId:'W',originalSource:original,originalTransaction:{...original,status:'PARTIAL_REFUND'}}),/ORIGINAL_CHANGED/);
  assert.deepEqual(f.state(),before);assert.equal(f.documents('inventoryLedger').length,1);assert.equal(f.documents('inventoryLedger')[0].qtyIn,4);
 }finally{db.getDocument=get;f.db.close();}
});
