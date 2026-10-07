/** Host regression using real V3 wrapper, real Articles component and production
 * POS category hooks extracted by AST. Only transport/catalog/storage are fixtures.
 * External Playwright required; this is not Android/device or performance approval.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';
const root=fileURLToPath(new URL('..',import.meta.url));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source=fs.readFileSync(path.join(root,'components/POSInterface.tsx'),'utf8');
const ast=ts.createSourceFile('POSInterface.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const initializers={},effects=[];
const visit=node=>{
  if(ts.isVariableDeclaration(node)&&node.initializer)initializers[node.name.getText(ast)]=node.initializer.getText(ast);
  if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect'){
    const code=node.getText(ast);if(code.includes('v3Operational.search(catalogSearchQuery')||code.includes('const selectedCategoryKey = categoryFilter'))effects.push(code);
  }
  ts.forEachChild(node,visit);
};visit(ast);assert.equal(effects.length,2);
const hooks=['normalizeScopeKey','categoryLookup','canonicalizeCategory','displayCategory','effectiveAllowedCategorySet','categoryOptions','categoryOptionIds'];
const posFixture=`
import React,{useCallback,useMemo,useEffect,useState} from 'react';
import {resolveClassificationActive,resolveClassificationColor,resolveClassificationSortOrder} from '${root}/utils/posCatalogPresentation';
import {resolveV3CategoryAliases} from '${root}/services/sync/LargeMasterSyncV3Categories';
export default function POSFixture(props){
 const {config,v3Operational}=props;
 const activeTerminalConfig=config.terminals[0].config;
 const catalogProducts=props.products;
 const salesCatalogProductEntries=[];
 const [categoryFilter,setCategoryFilter]=useState('ALL');
 const [catalogSearchQuery,setCatalogSearchQuery]=useState('');
 const [errorToast,setErrorToast]=useState('');
 ${hooks.map(name=>`const ${name}=${initializers[name]};`).join('\n')}
 ${effects.map(code=>code+';').join('\n')}
 window.fixtureState={categoryFilter,categories:categoryOptions.map(row=>row.id),visible:props.catalogSearchProducts.map(row=>row.category)};
 return <main><nav>{categoryOptions.map(row=><button key={row.id} data-category={row.id} onClick={()=>setCategoryFilter(row.id)}>{row.label}</button>)}</nav>
 <input aria-label="Search" value={catalogSearchQuery} onChange={e=>setCatalogSearchQuery(e.target.value)}/>
 <output id="selected">{categoryFilter}</output><output id="count">{props.catalogSearchProducts.length}</output><output id="error">{errorToast}</output></main>;
}`;
const mockSession=`
const names=['Bebidas','Carnes','Hamburguesas','CAFÉ','Extras'];
const articles=Array.from({length:325},(_,i)=>({id:'A'+i,name:'Product '+i,category:names[Math.floor(i/65)]}));
articles.push({id:'alias',name:'Alias',category:'CF'});
const metadata=names.map(label=>({key:label.toLowerCase(),label}));metadata.push({key:'cf',label:'CF'});
const source={async categories(){return metadata},async search(query,keys,limit){window.nativeSearches.push({query,keys,limit});
 const filter=keys==null?null:typeof keys==='string'?[keys]:keys;
 return articles.filter(row=>(!query.trim()||row.name.toLowerCase().includes(query.toLowerCase()))&&(!filter||filter.includes(row.category.toLowerCase()))).slice(0,limit).map(product=>({product}));}};
const ready={async projectConfig(config){return config},async catalog(){return source},async assertCurrent(){},async withStocks(rows){return rows}};
export async function getLargeMasterSyncV3OperationalSession(){return ready;}
`;
const mockReader=`export class LargeMasterSyncV3CatalogRead {static async open(){return {async page(request){
 window.adminRequests.push(request);const start=request.afterId?Number(request.afterId)+1:0;
 const rows=Array.from({length:Math.min(25,70-start)},(_,i)=>({id:String(start+i),name:'Product '+(start+i),price:10,balance:1,active:true,sellable:true}));
 return {total:70,filteredTotal:70,rows,nextCursor:start+25<70?String(start+24):null};}};}}`;
const result=await build({stdin:{resolveDir:root,loader:'tsx',contents:`
import React from 'react';import {createRoot} from 'react-dom/client';
import Operational from './components/LargeMasterSyncV3OperationalPOS';import Articles from './components/LargeMasterSyncV3CatalogManager';
Array.prototype.at=undefined;window.nativeSearches=[];window.adminRequests=[];
const config={families:[],posCategories:[{id:'category-id',code:'CF',name:'Café'}],taxes:[],tariffs:[{id:'T'}],terminals:[{id:'local',config:{pricing:{defaultTariffId:'T',allowedTariffIds:['T']},inventoryScope:{defaultSalesWarehouseId:'W'},catalog:{allowedCategories:['Bebidas','Carnes','Hamburguesas','Café','Extras']}}}]};
const root=createRoot(document.getElementById('root'));window.showPOS=()=>root.render(<Operational config={config} activeTerminalId="local" cart={[]} onOpenSettings={()=>{}}/>);
window.showArticles=()=>root.render(<Articles config={config} terminalId="local" warehouses={[]} onClose={()=>{}}/>);window.showPOS();
`},bundle:true,write:false,format:'iife',platform:'browser',plugins:[{name:'fixtures',setup(build){
 build.onResolve({filter:/\/POSInterface$/},args=>({path:args.path,namespace:'pos-fixture'}));
 build.onLoad({filter:/.*/,namespace:'pos-fixture'},()=>({contents:posFixture,loader:'tsx',resolveDir:root}));
 build.onResolve({filter:/LargeMasterSyncV3OperationalSession$/},args=>({path:args.path,namespace:'session-fixture'}));
 build.onLoad({filter:/.*/,namespace:'session-fixture'},()=>({contents:mockSession,loader:'ts'}));
 build.onResolve({filter:/LargeMasterSyncV3CatalogRead$/},args=>({path:args.path,namespace:'reader-fixture'}));
 build.onLoad({filter:/.*/,namespace:'reader-fixture'},()=>({contents:mockReader,loader:'ts'}));
}}]});
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
try{
 await page.setContent('<div id="root"></div>');await page.addScriptTag({content:result.outputFiles[0].text});
 await page.waitForFunction(()=>window.fixtureState?.visible.length===60);
 const categories=await page.locator('[data-category]').allTextContents();assert.equal(categories.length,6);assert.ok(categories.includes('Café'));
 for(const key of ['café','carnes','extras','hamburguesas','bebidas','ALL']){
   await page.locator(`[data-category="${key}"]`).click();await page.waitForFunction(key=>window.fixtureState.categoryFilter===key&&
     (key==='ALL'||window.fixtureState.visible.every(value=>value.toLowerCase()===key||key==='café'&&value==='CF')),key);
   assert.deepEqual(await page.locator('[data-category]').allTextContents(),categories);
 }
 await page.locator('[data-category="café"]').click();await page.waitForFunction(()=>window.nativeSearches.at===undefined&&window.nativeSearches[window.nativeSearches.length-1].keys?.includes('cf'));
 await page.getByLabel('Search').fill('Product 1');await page.waitForFunction(()=>window.nativeSearches[window.nativeSearches.length-1].query==='Product 1');
 assert.equal(await page.evaluate(()=>window.nativeSearches[window.nativeSearches.length-1].keys),null);
 assert.equal(await page.locator('#selected').textContent(),'café');
 await page.getByLabel('Search').fill('no such product');await page.waitForFunction(()=>window.fixtureState.visible.length===0);
 assert.equal(await page.locator('#selected').textContent(),'café');assert.deepEqual(await page.locator('[data-category]').allTextContents(),categories);
 await page.getByLabel('Search').fill('');await page.waitForFunction(()=>window.fixtureState.visible.length===60&&window.fixtureState.visible.every(row=>row==='CAFÉ'||row==='CF'));
 await page.evaluate(()=>window.showArticles());await page.waitForFunction(()=>window.adminRequests.length>0);
 await page.getByRole('button',{name:'Siguiente'}).click();await page.waitForFunction(()=>window.adminRequests[window.adminRequests.length-1].afterId==='24');
 await page.getByRole('button',{name:'Anterior'}).click();await page.waitForFunction(()=>window.adminRequests.length>=3&&window.adminRequests[window.adminRequests.length-1].afterId===null);
 assert.equal(errors.length,0,JSON.stringify(errors));assert.equal(await page.evaluate(()=>Array.prototype.at),undefined);
 const output=process.env.V3_CATEGORY_BROWSER_OUT||fs.mkdtempSync(path.join(os.tmpdir(),'v3-category-browser-'));
 fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,'articles.png')});
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({status:'host regression assertions passed',errors,categories,requests:await page.evaluate(()=>({nativeSearches:window.nativeSearches,adminRequests:window.adminRequests}))},null,2));
 console.log(output);
}finally{await browser.close();}
