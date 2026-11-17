import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { BusinessConfig, PrinterDevice } from '../types';
import { eligiblePrinters, isKnownUsbScanner, receiptPrinterPreference, withPrinterPreferences } from '../services/printer/PrinterPreferences';
import { PrintRouterService } from '../services/printer/PrintRouterService';
import { nativePrintBridge } from '../services/printer/NativePrintBridge';

const printer = (id: string, connection: PrinterDevice['connection']='NETWORK', type: PrinterDevice['type']='TICKET'): PrinterDevice => ({ id, name: id, connection, type, status:'CONNECTED', address: id });
const scanner = {...printer('usb:1504:6400:5003','USB'),name:'Symbol Bar Code Scanner::EA'};
const network = printer('10.0.0.151');
const usb = printer('usb:1208:3605:2','USB');
const bluetooth = printer('bt:printer','BLUETOOTH');
const kitchen = printer('kitchen','NETWORK','KITCHEN');
const fixture = (printers=[scanner,network,usb,bluetooth,kitchen]): BusinessConfig => ({
 availablePrinters:printers,
 terminals:[
  {id:'a',config:{erpTerminalId:'erp-a',hardware:{cashDrawerTrigger:'PRINTER',customerDisplay:{isEnabled:false},printerAssignments:{KITCHEN:'kitchen',LABEL:'label'}}}},
  {id:'b',config:{hardware:{cashDrawerTrigger:'DIRECT',receiptPrinterId:usb.id,printerAssignments:{TICKET:usb.id,LOGISTICS:'logistics'}}}},
 ],
} as any);

test('exclude the confirmed USB scanner, preserving thermal USB, Bluetooth and barcode printers',()=>{
 assert.equal(isKnownUsbScanner(scanner),true);
 assert.equal(isKnownUsbScanner({...scanner,id:'custom-scanner'}),true);
 assert.equal(isKnownUsbScanner({...scanner,id:'custom-scanner',name:'Vendor Barcode Scanner'}),true);
 assert.equal(isKnownUsbScanner({...scanner,id:'custom-scanner',name:'Vendor Bar Code Scanner'}),true);
 assert.equal(isKnownUsbScanner({...scanner,name:'Custom',id:'usb:1504:6400'}),true);
 for(const candidate of [network,usb,bluetooth,printer('usb:1504:9999:4','USB'),{...usb,name:'Symbol Barcode Printer'}, {...network,name:'Bar Code Scanner'}])assert.equal(isKnownUsbScanner(candidate),false);
 assert.deepEqual(eligiblePrinters([scanner,network,usb]),[network,usb]);
});

test('default save aligns both existing fields, preserves other terminals/roles and does not mutate input',()=>{
 const config=fixture();const original=JSON.stringify(config);
 for(const selected of [network,usb,bluetooth]){
  const result=withPrinterPreferences(config,'a',config.availablePrinters,selected.id);
  assert.equal(result.terminals[0].config.hardware.printerAssignments?.TICKET,selected.id);
  assert.equal(result.terminals[0].config.hardware.receiptPrinterId,selected.id);
  assert.equal(receiptPrinterPreference(result.terminals[0].config.hardware),selected.id);
  assert.equal(result.terminals[0].config.hardware.printerAssignments?.KITCHEN,'kitchen');
  assert.equal(result.terminals[0].config.hardware.printerAssignments?.LABEL,'label');
  assert.equal(result.terminals[1],config.terminals[1]);
  assert.deepEqual(result.terminals[0].config.hardware.customerDisplay,{isEnabled:false});
 }
 assert.equal(JSON.stringify(config),original);
});

test('legacy terminal without a hardware object can save its first default without changing another terminal',()=>{
 const config=fixture();delete (config.terminals[0].config as any).hardware;
 const result=withPrinterPreferences(config,'a',config.availablePrinters,network.id);
 assert.equal(receiptPrinterPreference(result.terminals[0].config.hardware),network.id);
 assert.equal(result.terminals[1],config.terminals[1]);
});

test('automatic mode clears both fields without resurrecting the old receipt id',()=>{
 const config=withPrinterPreferences(fixture(),'a',[network,usb],usb.id);
 const result=withPrinterPreferences(config,'a',config.availablePrinters,'');
 assert.equal(receiptPrinterPreference(result.terminals[0].config.hardware),'');
 assert.equal(result.terminals[0].config.hardware.receiptPrinterId,undefined);
 assert.equal(result.terminals[0].config.hardware.printerAssignments?.TICKET,undefined);
});

test('removing a printer clears only references to that ID, including stale scanner assignments',()=>{
 const config=fixture();
 config.terminals[0].config.hardware.receiptPrinterId=scanner.id;
 config.terminals[0].config.hardware.printerAssignments!.TICKET=scanner.id;
 config.terminals[1].config.hardware.printerAssignments!.LABEL=scanner.id;
 const result=withPrinterPreferences(config,'a',config.availablePrinters,scanner.id);
 assert.equal(result.availablePrinters.some(p=>p.id===scanner.id),false);
 assert.equal(receiptPrinterPreference(result.terminals[0].config.hardware),'');
 assert.equal(result.terminals[1].config.hardware.printerAssignments?.LABEL,undefined);
 assert.equal(result.terminals[1].config.hardware.printerAssignments?.LOGISTICS,'logistics');
 assert.equal(result.terminals[1].config.hardware.receiptPrinterId,usb.id);
 const deleted=withPrinterPreferences(result,'b',result.availablePrinters.filter(p=>p.id!==usb.id),usb.id);
 assert.equal(receiptPrinterPreference(deleted.terminals[1].config.hardware),'');
});

test('missing terminal or stale/other-role default cannot be silently saved',()=>{
 const config=fixture();
 assert.throws(()=>withPrinterPreferences(config,'unknown',config.availablePrinters,network.id),/terminal válida/);
 assert.throws(()=>withPrinterPreferences(config,'a',config.availablePrinters,'missing'),/ya no está disponible/);
 assert.throws(()=>withPrinterPreferences(config,'a',config.availablePrinters,kitchen.id),/ya no está disponible/);
 const changed=withPrinterPreferences(config,'a',config.availablePrinters.map(p=>p.id===network.id?{...p,type:'LABEL'}:p),'');
 assert.equal(receiptPrinterPreference(changed.terminals[0].config.hardware),'');
});

for(const transport of ['html','escpos'] as const){
 test(`actual ${transport} router sends observed scanner-first config to network once; all selection paths reject scanner`,async()=>{
  const original={isAvailable:nativePrintBridge.isAvailable,getRuntime:nativePrintBridge.getRuntime,printHtml:nativePrintBridge.printHtml,printEscPos:nativePrintBridge.printEscPos};
  const calls:any[]=[];
  nativePrintBridge.isAvailable=()=>true;nativePrintBridge.getRuntime=()=> 'ANDROID';
  nativePrintBridge.printHtml=async payload=>{calls.push(payload);return true};
  nativePrintBridge.printEscPos=async payload=>{calls.push(payload);return true};
  const run=async(config:BusinessConfig,preferredPrinterId?:string,role:any='TICKET')=>{
   const before=calls.length;
   const params={config,terminalId:'erp-a',role,preferredPrinterId};
   const result=transport==='html'?await PrintRouterService.routeAndPrintHtml({...params,html:'test'}):await PrintRouterService.routeAndPrintEscPos({...params,escPosBase64:'AQ=='});
   assert.equal(result,true);assert.equal(calls.length,before+1);return calls.at(-1);
  };
  try{
   const config=fixture();
   assert.equal((await run(config)).connection,'NETWORK');
   assert.equal((await run(config)).printerAddress,network.id);
   assert.equal((await run(config,scanner.id)).printerId,network.id);
   config.terminals[0].config.hardware.printerAssignments!.TICKET=scanner.id;
   config.terminals[0].config.hardware.receiptPrinterId=scanner.id;
   assert.equal((await run(config)).printerId,network.id);
   for(const device of [usb,bluetooth,network]){
    const selected=withPrinterPreferences(config,'a',config.availablePrinters,device.id);
    assert.equal((await run(selected)).printerId,device.id);
   }
   assert.equal((await run(config,kitchen.id)).printerId,kitchen.id,'explicit job override remains authoritative');
   assert.equal((await run(config,undefined,'KITCHEN')).printerId,kitchen.id);
   const bare=await run(fixture([scanner]));assert.equal(bare.printerId,undefined);assert.equal(bare.connection,undefined,'never sends scanner USB payload');
   assert.equal(calls.some(payload=>payload.printerId===scanner.id),false);
   let failures=0;
   nativePrintBridge.printHtml=async()=>{failures++;throw new Error('native transport failed')};
   nativePrintBridge.printEscPos=async()=>{failures++;throw new Error('native transport failed')};
   const params={config,terminalId:'erp-a',role:'TICKET' as const};
   await assert.rejects(transport==='html'?PrintRouterService.routeAndPrintHtml({...params,html:'test'}):PrintRouterService.routeAndPrintEscPos({...params,escPosBase64:'AQ=='}),/native transport failed/);
   assert.equal(failures,1,'a native failure must not retry through another printer or transport');
  }finally{Object.assign(nativePrintBridge,original)}
 });
}

test('Hardware UI uses a draft, guards edits, rehydrates terminal preference and persists only through Save',()=>{
 const source=readFileSync(new URL('../components/HardwareSettings.tsx',import.meta.url),'utf8');
 assert.match(source,/id="default-receipt-printer" value=\{defaultPrinterId\} disabled=\{printerEditingDisabled\}/);
 assert.match(source,/const printerEditingDisabled = isReadOnly \|\| isSavingHardware \|\| !currentTerminalConfig/);
 assert.match(source,/if \(!printerEditingDisabled\) setDefaultPrinterId\(event.target.value\)/);
 assert.match(source,/setDefaultPrinterId\(receiptPrinterPreference\(currentTerminalConfig\?\.config.hardware\)\)/);
 assert.match(source,/withPrinterPreferences\(globalConfig, selectedTerminalId, printers, defaultPrinterId\)/);
 assert.match(source,/if \(defaultPrinterId === p.id && selectedRole.type !== 'TICKET'\) setDefaultPrinterId\(''\)/);
 assert.match(source,/if \(defaultPrinterId === p.id\) setDefaultPrinterId\(''\)/);
 assert.match(source,/await onUpdateConfig\(newConfig\)/);
});

test('native USB candidate rejects only the known scanner before vendor OUT acceptance and uses it for discovery and resolution',()=>{
 const source=readFileSync(new URL('../native-stubs/android/ClicPOSNativePrinterBridge.kt',import.meta.url),'utf8');
 const predicate=source.slice(source.indexOf('private fun isUsbPrinterCandidate'),source.indexOf('private fun isPrintableUsbInterface'));
 assert.match(predicate,/device.vendorId == 1504 && device.productId == 6400/);
 assert.ok(predicate.indexOf('return false')<predicate.indexOf('USB_CLASS_PRINTER'));
 assert.match(predicate,/isPrintableUsbInterface/);
 for(const fn of ['discoverUsbPrinters','findUsbDevice']){
  const start=source.indexOf('private fun '+fn);const end=source.indexOf('\n    private fun ',start+1);
  assert.match(source.slice(start,end),/filter\(::isUsbPrinterCandidate\)/);
 }
});
