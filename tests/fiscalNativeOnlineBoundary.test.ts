import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertLabRequest,LAB_ERP_ORIGIN} from '../qa/fiscal-native/network-policy';
test('online laboratory exact origin/path/method boundary rejects production, acceptance, bootstrap and credential URL',()=>{
 for(const [path,method]of [['/__lab/health','GET'],['/__lab/metrics','GET'],['/__lab/inbox','POST'],['/api/fiscal/v2/documents/applied-receipt?environment=0','GET'],['/api/fiscal/documents/issue','POST']])assert.equal(assertLabRequest(LAB_ERP_ORIGIN+path,method).origin,LAB_ERP_ORIGIN);
 for(const [url,method]of [['https://clic-erp.clicsuite.com/__lab/health','GET'],['http://localhost:18765/__lab/health','GET'],[LAB_ERP_ORIGIN+'/api/sync/bootstrap/check','GET'],[LAB_ERP_ORIGIN+'/api/fiscal/documents/status','GET'],[LAB_ERP_ORIGIN+'/__lab/health','POST'],[LAB_ERP_ORIGIN+'/__lab/inbox','GET'],['http://user:password@127.0.0.1:18765/__lab/health','GET'],[LAB_ERP_ORIGIN+'/__lab/health#fragment','GET']])assert.throws(()=>assertLabRequest(url,method),/LAB_NETWORK_DENIED/);
});
test('online startup is preflight-only; original production entry and offline runner remain disconnected',()=>{
 const online=readFileSync(new URL('../qa/fiscal-native/online-runner.ts',import.meta.url),'utf8'),offline=readFileSync(new URL('../qa/fiscal-native/runner.ts',import.meta.url),'utf8');
 assert.match(online,/preflight\(\)\.catch/);assert.doesNotMatch(online,/start\(\)\.catch|fixtures\/|seedReceipt|window\.fetch\s*=/);assert.match(offline,/window\.fetch=async\(\)=>\{throw Error\('LAB_NO_NETWORK'\)/);
 const lost=online.slice(online.indexOf('const fetchImpl=async'),online.indexOf('return createMSellerDispatcher'));
 assert.ok(lost.indexOf('await request(url,init)')<lost.indexOf('await response.text()'));assert.ok(lost.indexOf('await response.text()')<lost.indexOf("throw Error('LAB_INJECTED_ACK_LOST_AFTER_REAL_RESPONSE')"));
 const dispatcher=readFileSync(new URL('../services/fiscal/FiscalMSellerDispatch.ts',import.meta.url),'utf8');assert.match(dispatcher,/assertReady:requireFiscalErpAppliedReceipt/);
});
