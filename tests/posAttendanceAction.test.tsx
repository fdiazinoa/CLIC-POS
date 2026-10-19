import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {Clock,Lock,Package,X,Printer,ChefHat,RefreshCw,Cloud,ListChecks} from 'lucide-react';
import ActionGrid from '../components/ActionGrid';
import ActionButtonsGrid from '../components/ActionButtonsGrid';
import IconOnlyActionGrid from '../components/IconOnlyActionGrid';
import SolidFlatActionFooter from '../components/SolidFlatActionFooter';
import InventoryTracking from '../components/InventoryTracking';

function buttons(node:React.ReactNode):React.ReactElement<any>[] {
 if(Array.isArray(node))return node.flatMap(buttons);if(!React.isValidElement(node))return [];
 const element=node as React.ReactElement<any>;return [...(element.type==='button'?[element]:[]),...buttons(element.props.children)];
}
const base={config:{operational:{}},parkedTicketsCount:0,globalDiscountValue:0,isReturnMode:false,hasCartItems:false,isMobile:false,screenWidth:1280};
for(const [name,Grid,slot,extra]of [['classic',ActionGrid,12,{}],['buttons',ActionButtonsGrid,10,{variant:'GRID'}],['icons',IconOnlyActionGrid,9,{}],['flat',SolidFlatActionFooter,9,{}]] as const){
 test(`${name} replaces main Rastreo in the same slot with one real Asistencia dispatch`,()=>{
  let tree:React.ReactNode;const actions:string[]=[];
  function Probe(){tree=(Grid as React.FC<any>)({...base,...extra,onAction:(action:string)=>actions.push(action)});return tree;}
  const html=renderToStaticMarkup(<Probe/>),items=buttons(tree!);assert.doesNotMatch(html,/Rastreo/);assert.match(html,/Asistencia/);assert.match(html,/lucide-clock/);
  assert.equal(items.length>slot,true);items[slot].props.onClick();assert.deepEqual(actions,['ATTENDANCE']);assert.equal(items.filter(item=>renderToStaticMarkup(item).includes('Asistencia')).length,1);
 });
}
const parse=(path:string)=>ts.createSourceFile(path,readFileSync(new URL('../'+path,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const pos=parse('components/POSInterface.tsx'),app=parse('App.tsx'),settings=parse('components/Settings.tsx');
function nodes<T extends ts.Node>(source:ts.SourceFile,match:(node:ts.Node)=>node is T):T[]{const found:T[]=[];function visit(node:ts.Node){if(match(node))found.push(node);ts.forEachChild(node,visit);}visit(source);return found;}
function declaration(source:ts.SourceFile,name:string){const value=nodes(source,(node):node is ts.VariableDeclaration=>ts.isVariableDeclaration(node)&&node.name.getText(source)===name)[0];assert.ok(value?.initializer,name);return value.initializer;}
function evaluate(node:ts.Node,bindings:Record<string,unknown>){const js=ts.transpileModule('const value='+node.getText()+';',{fileName:'source.tsx',compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;return new Function(...Object.keys(bindings),js+';return value;')(...Object.values(bindings));}
function attributes(source:ts.SourceFile,name:string){return nodes(source,(node):node is ts.JsxSelfClosingElement=>ts.isJsxSelfClosingElement(node)&&node.tagName.getText(source)===name);}
function attribute(node:ts.JsxSelfClosingElement,name:string){const value=node.attributes.properties.find(prop=>ts.isJsxAttribute(prop)&&prop.name.getText()===name) as ts.JsxAttribute;assert.ok(value?.initializer&&ts.isJsxExpression(value.initializer)&&value.initializer.expression,name);return value.initializer.expression;}

test('mobile shortcut renders Asistencia and calls the existing callback without opening inventory tracking',()=>{
 const candidates=nodes(pos,(node):node is ts.JsxElement=>ts.isJsxElement(node)&&node.openingElement.tagName.getText(pos)==='button'&&/Rast\.|Asist\./.test(node.getText(pos)));assert.equal(candidates.length,1);let attendance=0,tracking=0;
 const element=evaluate(candidates[0],{React,Clock,Package,onOpenAttendance:()=>{attendance++;},onOpenInventoryTracking:()=>{tracking++;}});const html=renderToStaticMarkup(element);assert.match(html,/Asistencia/);assert.doesNotMatch(html,/Rast\./);element.props.onClick();assert.equal(attendance,1);assert.equal(tracking,0);
});
test('existing grid attendance handler reaches App ATTENDANCE mode without changing a cart or clocking anyone',async()=>{
 let view='POS';const cart=[{id:'unchanged',quantity:2,price:5}],before=JSON.stringify(cart);
 const host=attributes(app,'PersistentPOSHost')[0];assert.ok(host);const open=evaluate(attribute(host,'onOpenAttendance'),{setCurrentView:(next:string)=>{view=next;}});
 await evaluate(declaration(pos,'handleGridAction'),{onOpenAttendance:open})('ATTENDANCE');assert.equal(view,'ATTENDANCE');assert.equal(JSON.stringify(cart),before);
 const team=attributes(app,'TeamHub').find(node=>node.attributes.properties.some(prop=>ts.isJsxAttribute(prop)&&prop.name.getText()==='mode'&&prop.initializer?.getText()==='"ATTENDANCE"'));assert.ok(team);evaluate(attribute(team,'onClose'),{setCurrentView:(next:string)=>{view=next;}})();assert.equal(view,'POS');
});
test('Settings Rastreo card, guarded route and back use the existing inventory module distinctly from checkout diagnostics',()=>{
 const card=attributes(settings,'SettingsCard').find(node=>node.attributes.properties.some(prop=>ts.isJsxAttribute(prop)&&prop.name.getText()==='label'&&prop.initializer?.getText()==='"Rastreo"'));assert.ok(card,'Settings inventory Rastreo card missing');
 const SettingsCard=evaluate(declaration(settings,'SettingsCard'),{React,Lock});
 for(const allowed of [false,true]){
  let view='HOME';const props={onClose:()=>{view='POS';}},setCurrentView=(next:string)=>{view=next;};const bindings={React,Package,SettingsCard,hasPermission:(permission:string)=>{assert.equal(permission,'SETTINGS_ACCESS');return allowed;},setCurrentView};
  const element=evaluate(card,bindings);assert.match(renderToStaticMarkup(element),/Rastreo/);const button=SettingsCard(element.props);assert.equal(typeof button.props.onClick,allowed?'function':'undefined');if(!allowed)continue;button.props.onClick();assert.equal(view,'INVENTORY_TRACKING');
  const route=evaluate(declaration(settings,'renderContent'),{React,InventoryTracking,hasPermission:()=>allowed,setCurrentView,currentView:view,isOrderTakerMode:false});const screen=route();assert.equal(screen.type,InventoryTracking);assert.match(renderToStaticMarkup(screen),/Rastreo|Trazabilidad/);screen.props.onClose();assert.equal(view,'HOME');props.onClose();assert.equal(view,'POS');
 }
 const denied=evaluate(declaration(settings,'renderContent'),{React,InventoryTracking,hasPermission:()=>false,currentView:'INVENTORY_TRACKING',isOrderTakerMode:false});assert.equal(denied(),null);
 const restricted=evaluate(declaration(settings,'renderContent'),{React,SettingsCard,InventoryTracking,X,Printer,ChefHat,RefreshCw,Cloud,ListChecks,hasPermission:()=>true,currentView:'INVENTORY_TRACKING',ORDER_TAKER_SETTINGS_VIEWS:evaluate(declaration(settings,'ORDER_TAKER_SETTINGS_VIEWS'),{}),isOrderTakerMode:true,props:{onClose:()=>{}},setCurrentView:()=>{},isCheckingApkUpdate:false,handleManualApkUpdateCheck:()=>{}});
 const html=renderToStaticMarkup(restricted());assert.match(html,/Configuración de esta tableta/);assert.doesNotMatch(html,/Trazabilidad|Rastreo/);
});
