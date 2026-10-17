import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertLabRequest,assertLabInput,LAB_ERP_ORIGIN} from '../qa/fiscal-native/network-policy';
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

test('online inputs reject crossed headers, fiscal master and malformed catalog before operation',()=>{
 const scope={tenantId:'22222222-2222-4222-8222-222222222222',companyId:'44444444-4444-4444-8444-444444444444',storeId:'33333333-3333-4333-8333-333333333333',terminalId:'11111111-1111-4111-8111-111111111111',deviceId:'synthetic-device'};
 const value:any={connection:{scope,headers:{'x-tenant-id':scope.tenantId,'x-terminal-id':scope.terminalId,'x-device-id':scope.deviceId,authorization:'Bearer synthetic','x-sync-token':'synthetic','x-device-token':'synthetic'}},fiscalMaster:{...scope,ncfType:'E32',prefix:'E32',issuerRnc:'130090752',fiscalRangeId:'55555555-5555-4555-8555-555555555555',fiscalAllocationId:'66666666-6666-4666-8666-666666666666',rangeStart:1,rangeEnd:99999,allocationStart:1001,allocationEnd:2000},catalog:{sale:{article:{id:'77777777-7777-4777-8777-777777777777',type:'PRODUCT',inventoriable:true,taxable:false,activeWarehouseIds:['88888888-8888-4888-8888-888888888888']},price:100,tariff:{taxIncluded:false}}}};
 assert.doesNotThrow(()=>assertLabInput(value));
 for(const patch of [(v:any)=>v.connection.headers['x-tenant-id']='foreign',(v:any)=>v.fiscalMaster.companyId='foreign',(v:any)=>v.fiscalMaster.issuerRnc='bad',(v:any)=>v.catalog.sale.article.id='SKU',(v:any)=>v.catalog.sale.article.activeWarehouseIds=['SKU'],(v:any)=>v.fiscalMaster.allocationStart=2001]){const bad=structuredClone(value);patch(bad);assert.throws(()=>assertLabInput(bad),/LAB_INPUT_CONFLICT/);}
});

test('laboratory selects static offline/online manifests; no tools directive placeholders',()=>{
 const read=(path:string)=>readFileSync(new URL('../qa/fiscal-native/android/app/'+path,import.meta.url),'utf8');
 const offline=read('src/main/AndroidManifest.xml'),online=read('src/online/AndroidManifest.xml'),gradle=read('build.gradle');
 assert.match(offline,/<uses-permission android:name="android.permission.INTERNET" tools:node="remove"/);
 assert.match(online,/<uses-permission android:name="android.permission.INTERNET" \/>/);
 for(const manifest of [offline,online]){assert.doesNotMatch(manifest,/\$\{/);assert.match(manifest,/android:allowBackup="false"/);assert.match(manifest,/android:usesCleartextTraffic="false"/);assert.match(manifest,/android:networkSecurityConfig="@xml\/lab_network_security"/);}
 assert.match(gradle,/manifest.srcFile providers.gradleProperty\('fiscalQaOnline'\).getOrElse\('false'\) == 'true' \? 'src\/online\/AndroidManifest.xml' : 'src\/main\/AndroidManifest.xml'/);
 assert.doesNotMatch(gradle,/manifestPlaceholders/);
});

test('HTML shell has explicit head for Capacitor fallback injection before laboratory script and native preflight precedes DB',()=>{
 const build=readFileSync(new URL('../qa/fiscal-native/build-bundle.mjs',import.meta.url),'utf8'),runner=readFileSync(new URL('../qa/fiscal-native/online-runner.ts',import.meta.url),'utf8');
 const html=build.match(/<!doctype html>(.*?)<\/html>/)?.[0];assert.ok(html);assert.ok(html.indexOf('<head>')<html.indexOf('</head>'));assert.ok(html.indexOf('</head>')<html.indexOf('<script src="lab.js">'));assert.match(html,/<body>.*<\/body>/);assert.match(html,/white-space:pre-wrap;word-break:break-word/);
 const preflight=runner.slice(runner.indexOf('async function preflight()'),runner.indexOf('async function open('));assert.match(preflight,/Capacitor.isPluginAvailable\('CapacitorSQLite'\)/);assert.match(preflight,/LAB_NATIVE_SQLITE_BRIDGE_UNAVAILABLE/);assert.doesNotMatch(preflight,/await open\(|createConnection\(/);
});
