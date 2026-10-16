import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const app=ts.createSourceFile('App.tsx',readFileSync(new URL('../App.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const settings=ts.createSourceFile('Settings.tsx',readFileSync(new URL('../components/Settings.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function elements(source:ts.SourceFile,name:string){
 const result:(ts.JsxOpeningElement|ts.JsxSelfClosingElement)[]=[];
 const visit=(node:ts.Node)=>{if((ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))&&node.tagName.getText(source)===name)result.push(node);ts.forEachChild(node,visit);};
 visit(source);return result;
}
function attribute(node:ts.JsxOpeningElement|ts.JsxSelfClosingElement,name:string){
 const attr=node.attributes.properties.find(prop=>ts.isJsxAttribute(prop)&&prop.name.getText()===name) as ts.JsxAttribute;
 assert.ok(attr?.initializer&&ts.isJsxExpression(attr.initializer)&&attr.initializer.expression,`missing ${name}`);
 return attr.initializer.expression;
}
function evaluate(node:ts.Node,scope:Record<string,any>){
 const js=ts.transpileModule('const callback='+node.getText()+';', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 return new Function(...Object.keys(scope),js+'return callback;')(...Object.values(scope));
}
const appSettings=elements(app,'Settings');assert.equal(appSettings.length,2);
for(const [index,route] of ['SETTINGS','SETTINGS_SYNC'].entries()){
 test(`actual ${route} callback opens existing history, clears scan and closes to same Settings`,()=>{
  let view='SETTINGS',scan:any='old-selection';const origin={current:'POS'};
  const scope={roles:[{id:'cashier',permissions:['SETTINGS_ACCESS']}],currentUser:{role:'cashier'},getCurrentDeviceRole:()=> 'STANDARD_POS',DeviceRole:{ORDER_TAKER:'ORDER_TAKER'},isAdminMode:false,
   historyReturnViewRef:origin,setScanTargetTicketId:(value:any)=>{scan=value;},setCurrentView:(value:string)=>{view=value;}};
  evaluate(attribute(appSettings[index],'onOpenHistory'),scope)();assert.equal(view,'HISTORY');assert.equal(origin.current,route);assert.equal(scan,null);
  const history=elements(app,'TicketHistory').find(node=>attribute(node,'onClose').getText().includes('historyReturnViewRef'))!;
  evaluate(attribute(history,'onClose'),scope)();assert.equal(view,route);assert.equal(origin.current,'POS');assert.equal(scan,null);
 });
 for(const access of ['missing-user','denied','order-taker','admin-order-taker'] as const)test(`actual ${route} history callback denies ${access}`,()=>{
  const roles=[{id:'cashier',permissions:access==='denied'?[]:['SETTINGS_ACCESS']}];let transitions=0;
  evaluate(attribute(appSettings[index],'onOpenHistory'),{roles,currentUser:access==='missing-user'?null:{role:'cashier'},getCurrentDeviceRole:()=>access.includes('order-taker')?'ORDER_TAKER':'STANDARD_POS',DeviceRole:{ORDER_TAKER:'ORDER_TAKER'},isAdminMode:access==='admin-order-taker',
   historyReturnViewRef:{current:'POS'},setScanTargetTicketId:()=>{transitions++;},setCurrentView:()=>{transitions++;}})();assert.equal(transitions,0);
 });
}

test('Settings history card guards its callback and keeps SETTINGS_ACCESS instead of invoice audit permission',()=>{
 const card=elements(settings,'SettingsCard').find(node=>node.attributes.properties.some(prop=>ts.isJsxAttribute(prop)&&prop.name.getText()==='label'&&prop.initializer?.getText()==='"Historial de facturas"'))!;
 assert.ok(card);let opens=0;
 for(const [allowed,orderTaker,expected]of [[false,false,0],[true,true,0],[true,false,1]] as const){
  evaluate(attribute(card,'onClick'),{isOrderTakerMode:orderTaker,hasPermission:(permission:string)=>{assert.equal(permission,'SETTINGS_ACCESS');return allowed;},props:{onOpenHistory:()=>{opens++;}}})();assert.equal(opens,expected);
 }
 assert.equal(evaluate(attribute(card,'locked'),{hasPermission:()=>true,props:{}}),true);
});

test('POS history and invoice scan override a previous Settings origin back to POS',()=>{
 for(const name of ['onOpenHistory','onOpenInvoiceActions']){
  const pos=elements(app,'PersistentPOSHost')[0];assert.ok(pos);let view='',scan:any=null;const origin={current:'SETTINGS'};
  evaluate(attribute(pos,name),{historyReturnViewRef:origin,setCurrentView:(value:string)=>{view=value;},setScanTargetTicketId:(value:any)=>{scan=value;}})('invoice-id');
  assert.equal(origin.current,'POS');assert.equal(view,'HISTORY');assert.equal(scan,name==='onOpenInvoiceActions'?'invoice-id':null);
 }
});
