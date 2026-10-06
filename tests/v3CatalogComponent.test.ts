import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

test('executable readonly component resets cursor/search/context, ignores late completion and exposes no mutation', async () => {
  const slots:any[]=[];let index=0;let dirty=false;const effects:Array<()=>void>=[];
  const timers=new Map<number,()=>void>();let timerId=0;
  const hooks={
    createElement:(type:any,props:any,...children:any[])=>({type,props:{...props,children}}),
    useState:(initial:any)=>{const at=index++;if(!slots[at])slots[at]={value:typeof initial==='function'?initial():initial};
      return [slots[at].value,(next:any)=>{const value=typeof next==='function'?next(slots[at].value):next;
        if(value!==slots[at].value){slots[at].value=value;dirty=true;}}];},
    useRef:(initial:any)=>{const at=index++;return slots[at]??(slots[at]={current:initial});},
    useSyncExternalStore:(_subscribe:any,get:any)=>get(),
    useEffect:(effect:any,deps:any[])=>{const at=index++;const previous=slots[at];
      if(!previous||deps.some((value,i)=>value!==previous.deps[i])) {slots[at]={deps,cleanup:previous?.cleanup};
        effects.push(()=>{slots[at].cleanup?.();slots[at].cleanup=effect();});}},
  };
  let opens=0;const requests:any[]=[];let lateResolve:any;let hold=false;
  const page={total:300,filteredTotal:300,rows:[],nextCursor:'P000025'};
  const read={open:async()=>{opens++;return {page:async(request:any)=>{requests.push(request);
    if(hold){hold=false;return new Promise(resolve=>{lateResolve=resolve;});}return page;}};}};
  const built=await build({entryPoints:['components/LargeMasterSyncV3CatalogManager.tsx'],bundle:true,write:false,
    platform:'node',format:'cjs',jsx:'transform',tsconfigRaw:{compilerOptions:{jsx:'react'}},plugins:[{name:'component-fixture',setup(builder){
      builder.onResolve({filter:/^react$/},()=>({path:'react',namespace:'fixture'}));
      builder.onResolve({filter:/LargeMasterSyncV3CatalogRead$/},()=>({path:'read',namespace:'fixture'}));
      builder.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='react'
        ?'module.exports=globalThis.__catalogHooks;module.exports.default=module.exports;'
        :'exports.LargeMasterSyncV3CatalogRead=globalThis.__catalogRead;'}));
    }}]});
  const previousWindow=(globalThis as any).window;
  Object.assign(globalThis,{__catalogHooks:hooks,__catalogRead:read,window:{setTimeout:(callback:()=>void)=>{
    const id=++timerId;timers.set(id,callback);return id;},clearTimeout:(id:number)=>timers.delete(id)}});
  const module={exports:{} as any};new Function('module','exports',built.outputFiles[0].text)(module,module.exports);
  const exported=module.exports;
  let props:any={terminalId:'local',config:{terminals:[{id:'local',config:{currentDeviceId:'device',erpTerminalId:'erp',
    pricing:{defaultTariffId:'T'},inventoryScope:{defaultSalesWarehouseId:'W'}}}]},warehouses:[{id:'W'}],onClose:()=>{},
    onUpdateProducts:()=>{throw Error('mutation callback must never be consumed');}};
  let tree:any;
  const render=()=>{for(let count=0;count<10;count++){dirty=false;index=0;tree=exported.default(props);
    while(effects.length)effects.shift()!();if(!dirty)return;}throw Error('render loop');};
  const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();render();};
  const find=(predicate:(node:any)=>boolean,node=tree):any=>{if(!node||typeof node!=='object')return;
    if(Array.isArray(node)){for(const child of node){const match=find(predicate,child);if(match)return match;}return;}
    return predicate(node)?node:find(predicate,node.props?.children);};
  const button=(text:string)=>find(node=>node.type==='button'&&node.props.children.includes(text));
  try {
    render();await settle();assert.equal(opens,1);assert.equal(requests.length,1);assert.equal(requests[0].afterId,null);
    button('Siguiente').props.onClick();render();await settle();assert.equal(requests.at(-1).afterId,'P000025');
    find(node=>node.type==='input').props.onChange({target:{value:'new query'}});render();
    assert.equal(requests.length,2);for(const callback of [...timers.values()])callback();timers.clear();render();await settle();
    assert.equal(requests.at(-1).afterId,null);assert.equal(requests.at(-1).query,'new query');
    button('Siguiente').props.onClick();render();await settle();
    find(node=>node.type==='select').props.onChange({target:{value:'NONE'}});render();await settle();
    assert.equal(requests.at(-1).afterId,null);assert.equal(requests.at(-1).category,'NONE');
    hold=true;button('Siguiente').props.onClick();render();await settle();assert.ok(lateResolve);
    props={...props,terminalId:'new-terminal',config:{terminals:[]}};render();await settle();
    assert.equal(opens,2);assert.equal(requests.at(-1).afterId,null);
    lateResolve({...page,total:999});await settle();
    const visible=find(node=>typeof node.type==='function'&&node.type.name==='V3CatalogPageView');
    assert.equal(visible.props.state.page.total,300);
    for(const action of ['Editar','Guardar','Eliminar','Importar','Nuevo'])assert.equal(button(action),undefined);
    for(const slot of slots)slot?.cleanup?.();
  }finally{(globalThis as any).window=previousWindow;delete (globalThis as any).__catalogHooks;delete (globalThis as any).__catalogRead;}
});

test('actual Settings route preserves OFF/nonERP V2 and permission-gates readonly V3 even programmatic initialView',async()=>{
  let enabled=true;let kind='ERP_ACTIVE';let writes=0;
  const react={createElement:(type:any,props:any,...children:any[])=>({type,props:{...props,children}}),
    useState:(value:any)=>[value,()=>{}],useEffect:()=>{},lazy:(factory:any)=>({lazy:factory.toString()}),Suspense:'suspense'};
  const built=await build({entryPoints:['components/Settings.tsx'],bundle:true,write:false,platform:'node',format:'cjs',
    tsconfigRaw:{compilerOptions:{jsx:'react'}},plugins:[{name:'settings-fixture',setup(builder){
      builder.onResolve({filter:/.*/},args=>args.kind==='entry-point'?undefined:{path:args.path,namespace:'fixture'});
      builder.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='react'
        ?'module.exports=globalThis.__settingsReact;module.exports.default=module.exports;'
        :path.endsWith('LargeMasterSyncV3Authority')?'Object.defineProperty(exports,"LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED",{get:()=>globalThis.__settingsEnabled()});'
        :path.endsWith('SyncProfile')?'exports.resolveSyncTarget=()=>({kind:globalThis.__settingsKind()});'
        :path.endsWith('LargeMasterSyncV3CatalogRead')?'exports.useV3CatalogBrowser=(enabled,kind)=>enabled&&kind==="ERP_ACTIVE";'
        :path.endsWith('deviceRoleHelpers')?'exports.resolveDeviceRoleValue=()=>"STANDARD_POS";'
        :path.endsWith('/types')?'exports.DeviceRole={STANDARD_POS:"STANDARD_POS",ORDER_TAKER:"ORDER_TAKER"};'
        :'module.exports=new Proxy(function(){},{get:(_,key)=>key==="__esModule"?false:function(){}});'}));
    }}]});
  Object.assign(globalThis,{__settingsReact:react,__settingsEnabled:()=>enabled,__settingsKind:()=>kind});
  const module={exports:{} as any};new Function('module','exports',built.outputFiles[0].text)(module,module.exports);
  const props:any={initialView:'CATALOG',config:{terminals:[]},roles:[{id:'role',permissions:['CATALOG_VIEW']}],
    currentUser:{role:'role'},products:[],warehouses:[],users:[],onUpdateProducts:()=>writes++,onClose:()=>{}};
  const find=(predicate:(node:any)=>boolean,node:any):any=>{if(!node||typeof node!=='object')return;
    if(Array.isArray(node)){for(const child of node){const value=find(predicate,child);if(value)return value;}return;}
    return predicate(node)?node:find(predicate,node.props?.children);};
  const route=()=>find(node=>node.type?.lazy?.includes('CatalogManager'),module.exports.default(props));
  try {
    const v3=route();assert.ok(v3.type.lazy.includes('LargeMasterSyncV3CatalogManager'));
    assert.equal(v3.props.onUpdateProducts,undefined);assert.equal(v3.props.products,undefined);
    // An injected update callback is never forwarded/available to invoke on the candidate route.
    v3.props.onUpdateProducts?.([]);assert.equal(writes,0);
    props.currentUser=null;assert.equal(route(),undefined);
    assert.ok(find(node=>node.props?.role==='alert',module.exports.default(props)));
    props.currentUser={role:'role'};
    enabled=false;assert.ok(!route().type.lazy.includes('LargeMasterSyncV3CatalogManager'));assert.equal(route().props.onUpdateProducts,props.onUpdateProducts);
    enabled=true;for(const other of ['LAN','LOCAL','ERP_CLIENT','UNBOUND']){kind=other;assert.ok(!route().type.lazy.includes('LargeMasterSyncV3CatalogManager'));}
  }finally{delete (globalThis as any).__settingsReact;delete (globalThis as any).__settingsEnabled;delete (globalThis as any).__settingsKind;}
});
