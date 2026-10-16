import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {Layers,ShoppingBag,Trash2,Search,X,ScanBarcode} from 'lucide-react';
import OrderServiceTypeButton from '../components/OrderServiceTypeButton';
import SalesOperatorIdentity from '../components/SalesOperatorIdentity';
import {TicketStatusControls,FiscalStatusBadge} from '../components/POSStatusIndicators';

const source=readFileSync(new URL('../components/POSInterface.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('POSInterface.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function element(marker:string){let found:ts.JsxElement|undefined;function visit(node:ts.Node){if(ts.isJsxElement(node)&&node.openingElement.attributes.properties.some(p=>ts.isJsxAttribute(p)&&p.initializer?.getText(ast).includes(marker)))found=node;ts.forEachChild(node,visit);}visit(ast);assert.ok(found,marker);return found.getText(ast);}
const toolbar=element('desktop-ticket-toolbar'),leftIdentity=element('pos-catalog-identity');
const footer=source.slice(source.indexOf('   const renderDesktopTicketFooterActions ='),source.indexOf('   return (\n      <div\n         ref={posRootRef}'));
const user={id:'u',name:'Jonas Nombre Largo',photo:'https://example.invalid/cashier.jpg'};
function context(patch:Record<string,unknown>={}){return {React,Layers,ShoppingBag,Trash2,Search,X,ScanBarcode,OrderServiceTypeButton,TicketStatusControls,FiscalStatusBadge,
 isRetailMode:false,isTabletProfile:false,isRestaurantMode:false,isMobile:false,isKioskMode:false,isOrderTakerMode:false,isFiscalModeDisabled:false,canCheckoutWithFiscalPolicy:true,fiscalStatus:{type:'B02',hasNCF:true,isTerminalBlock:true},
 currentUser:user,terminalDisplayLabel:'Mast2',renderTicketBrand:()=> <SalesOperatorIdentity user={user} terminalLabel="Mast2"/>,
 effectiveOrderServiceType:'DINE_IN',handleGridAction:()=>{},searchTerm:'',filteredProducts:[],retailSearchInputRef:{current:null},
 cart:[{cartId:'fresh',quantity:1}],hasClearableFreshItems:true,rightSidebarTab:'CART',setRightSidebarTab:()=>{},handleClearFreshCartItems:()=>{},...patch};}
function evaluate(expression:string,scope:ReturnType<typeof context>){return runInNewContext(ts.transpileModule(expression,{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText,scope);}
function header(scope:ReturnType<typeof context>){return evaluate(`(${toolbar});`,scope) as React.ReactElement;}
function lower(scope:ReturnType<typeof context>){return evaluate(`${footer}\nrenderDesktopTicketFooterActions();`,scope) as React.ReactElement;}
function nodes(node:any):any[]{if(!node||typeof node!=='object')return [];return [node,...React.Children.toArray(node.props?.children).flatMap(nodes)];}

test('actual desktop toolbar renders one service control and exactly one identity across catalog/full retail',()=>{
 for(const retail of [false,true])for(const kiosk of [false,true])for(const service of ['DINE_IN','TAKEOUT','DELIVERY']){
  const scope=context({isRetailMode:retail,isKioskMode:kiosk,effectiveOrderServiceType:service});
  const html=renderToStaticMarkup(<>{!retail&&evaluate(`(${leftIdentity});`,scope)}{header(scope)}</>);
  assert.equal((html.match(/Foto de Jonas Nombre Largo/g)||[]).length,retail?1:0); // left catalog image keeps its original markup without alt.
  assert.equal((html.match(/src="https:\/\/example.invalid\/cashier.jpg"/g)||[]).length,1);
  assert.equal((html.match(/data-testid="ticket-service-type-button"/g)||[]).length,kiosk?0:1);
  assert.doesNotMatch(html,/Guardar ticket|Abrir acciones rápidas|Abrir carrito|Borrar artículos nuevos/);
  const buttons=nodes(header(scope)).filter(n=>n.type===OrderServiceTypeButton);assert.equal(buttons.length,kiosk?0:1);
  if(!kiosk){let action='';const interactive=header(context({isRetailMode:retail,effectiveOrderServiceType:service,handleGridAction:(value:string)=>action=value}));const button=nodes(interactive).find(n=>n.type===OrderServiceTypeButton);assert.equal(button.props.value,service);button.props.onClick();assert.equal(action,'TAKEOUT');}
 }
});

test('actual lower navigation toggles both ways independent of CART-only totals and preserves bulk guard/handler',()=>{
 for(const tab of ['CART','ACTIONS'])for(const hasItems of [false,true])for(const clearable of [false,true]){
  let next=tab;const clear=()=>{};const scope=context({rightSidebarTab:tab,cart:hasItems?[{cartId:'line'}]:[],hasClearableFreshItems:clearable,handleClearFreshCartItems:clear,setRightSidebarTab:(fn:(tab:string)=>string)=>next=fn(tab)});
  const tree=lower(scope),html=renderToStaticMarkup(tree);assert.match(html,tab==='CART'?/Opciones/:/Ver ticket/);
  const navigation=nodes(tree).find(n=>n.type==='button'&&n.props['aria-pressed']!==undefined);navigation.props.onClick();assert.equal(next,tab==='CART'?'ACTIONS':'CART');
  const deletion=nodes(tree).find(n=>n.props?.['aria-label']==='Borrar artículos nuevos del ticket');assert.equal(Boolean(deletion),hasItems);
  if(deletion){assert.equal(deletion.props.onClick,clear);assert.equal(deletion.props.disabled,!clearable);}
 }
 for(const tab of ['CART','ACTIONS']){const html=renderToStaticMarkup(lower(context({isRetailMode:true,rightSidebarTab:tab})));assert.doesNotMatch(html,/Opciones|Ver ticket/);assert.match(html,/Borrar artículos nuevos del ticket/);}
 assert.equal(lower(context({isMobile:true})),false);assert.equal(lower(context({isRetailMode:true,cart:[]})),false);
 const visualFooter=source.slice(source.indexOf('// --- VISUAL MODE FOOTER (VERTICAL) ---'),source.indexOf('{/* MOBILE STICKY FOOTER */}'));
 assert.ok(visualFooter.indexOf('{renderDesktopTicketFooterActions()}')<visualFooter.indexOf("rightSidebarTab === 'CART'"),'navigation must remain outside CART-only footer');
});
