import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';
import { createRemoteAd, normalizeMediaAsset } from '../utils/media';
import { normalizeCustomerDisplayConfig } from '../utils/customerDisplay';

test('actual explicit ad action handles signed extensionless video/image, poster/cancel/invalid/readOnly and late terminal changes', async () => {
  const source=readFileSync(new URL('../components/HardwareSettings.tsx',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('const addAd ='),source.indexOf('const toggleAdActive ='));
  const js=(await transform(body,{loader:'ts',target:'es2022'})).code;
  for (const scenario of ['video','image','poster','cancel','cancel-poster','invalid','invalid-poster','readonly','scope-change','unmount']) {
    let config:any={ads:[{id:'existing',type:'IMAGE',url:'https://cdn.test/old',active:true}]};
    const initial=JSON.stringify(config); const alerts:string[]=[]; let prompts=0;
    const context={signature:'T:company',active:true}; let signature='T:company';
    const deps={ isReadOnly:scenario==='readonly',currentTerminalConfig:{id:'T'},adContext:{current:context},
      adContextSignature:()=>signature,createRemoteAd,
      clicPrompt:async()=>{prompts++;if(scenario==='scope-change'){signature='T2:company';context.signature=signature;}
        if(scenario==='unmount')context.active=false;
        if(scenario==='cancel'||scenario==='cancel-poster'&&prompts===2)return null;
        if(scenario==='invalid'||scenario==='invalid-poster'&&prompts===2)return 'javascript:alert(1)';
        return prompts===1?'https://cdn.test/signed-resource?token=fixture':scenario==='poster'?'https://cdn.test/poster':'';},
      setDisplayConfig:(update:any)=>{config=update(config);},alert:(message:string)=>alerts.push(message),
    };
    const add=new Function(...Object.keys(deps),`${js};return addAd;`)(...Object.values(deps));
    await add({preventDefault(){},stopPropagation(){}},scenario==='image'?'IMAGE':'VIDEO');
    if(['video','image','poster'].includes(scenario)) {
      assert.equal(config.ads.length,2);assert.equal(config.ads[1].type,scenario==='image'?'IMAGE':'VIDEO');
      assert.equal(normalizeCustomerDisplayConfig(JSON.parse(JSON.stringify(config))).ads[1].type,config.ads[1].type);
      if(scenario==='poster')assert.equal(config.ads[1].posterUrl,'https://cdn.test/poster');
    } else assert.equal(JSON.stringify(config),initial);
    if(scenario==='readonly')assert.equal(prompts,0);
    if(scenario.startsWith('invalid'))assert.equal(alerts.length,1);
  }
  assert.equal(normalizeMediaAsset(createRemoteAd('https://cdn.test/file.mp4','IMAGE'))?.type,'IMAGE');
  assert.equal(normalizeMediaAsset(createRemoteAd('https://cdn.test/opaque','VIDEO'))?.type,'VIDEO');
  assert.match(source,/Agregar imagen/);assert.match(source,/Agregar video/);
});

test('actual visor renders typed extensionless video and formatted canonical quantities without changing totals', async () => {
  const { build }=await import('esbuild');
  const fixture={cart:[{name:'BAL',quantity:.5715263862000001,price:1.23456789}],subtotal:1,tax:.18,total:1.18,currencySymbol:'$',salesQuantityDecimals:3,
    ads:[createRemoteAd('https://cdn.test/signed-resource','VIDEO','https://cdn.test/poster','v')]};
  const before=JSON.stringify(fixture);let calls=0;
  const react={createElement:(type:any,props:any,...children:any[])=>({type,props:{...props,children}}),useEffect(){},useRef:(value:any)=>({current:value}),
    useState:(initial:any)=>[calls++===0?fixture:initial,()=>{}]};
  (globalThis as any).__quantityVisorReact=react;
  try {
    const result=await build({entryPoints:['components/CustomerVisor.tsx'],bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'visor-fixture',setup(b){
      const mocks:Record<string,string>={react:'const r=globalThis.__quantityVisorReact;export default r;export const useState=r.useState,useRef=r.useRef,useEffect=r.useEffect;',
        'react/jsx-runtime':'export const jsx=(type,props)=>globalThis.__quantityVisorReact.createElement(type,props,...[].concat(props.children||[]));export const jsxs=jsx;export const Fragment="fragment";',
        'lucide-react':'export const ShoppingCart=()=>null,Monitor=ShoppingCart,MonitorPlay=ShoppingCart,Zap=ShoppingCart;',
        '../utils/visorSync':'export const visorSync={};'};
      b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'visor-fixture'}:undefined);
      b.onLoad({filter:/.*/,namespace:'visor-fixture'},a=>({contents:mocks[a.path],loader:'ts'}));
    }}]});
    const module={exports:{} as any};new Function('module','exports',result.outputFiles[0].text)(module,module.exports);
    const tree=module.exports.default();
    const walk=(node:any,predicate:(node:any)=>boolean):any=>!node||typeof node!=='object'?undefined:predicate(node)?node:(Array.isArray(node)?node:node.props?.children||[]).map((child:any)=>walk(child,predicate)).find(Boolean);
    const text=(node:any):string=>typeof node==='string'||typeof node==='number'?String(node):!node?'':(Array.isArray(node)?node:node.props?.children||[]).map(text).join('');
    const video=walk(tree,node=>node.type==='video');assert.ok(video);assert.equal(video.props.src,fixture.ads[0].url);assert.equal(video.props.poster,fixture.ads[0].posterUrl);
    assert.equal(video.props.autoPlay,true);assert.equal(video.props.muted,true);
    assert.match(text(tree),/0\.572X/);assert.doesNotMatch(text(tree),/5715263862000001/);
    assert.equal(JSON.stringify(fixture),before);
  }finally{delete (globalThis as any).__quantityVisorReact;}
});
