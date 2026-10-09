import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { getRenderableFloorTables, hasExplicitTableLayout } from '../utils/tableLayout';
import { uniqueDesignerTable } from '../utils/tableDesignerGeometry';

const fixture = (): any[] => Array.from({ length: 12 }, (_, index) => ({ id: `t${index+1}`, roomId: 'R', name: `Mesa ${index+1}`, status: 'FREE',
  capacity: 4, metadata: { retained: index }, ...(index === 3 ? { shape: 'CIRCLE', posX: 500, posY: 80, width: 100, height: 100, rotation: 15 } : {}) }));

test('actual designer handlers move fallback Mesa12 and explicit Mesa4 without losing source identity/concurrent operational data', async () => {
  let cursor=0;let slots:any[]=[];let pendingEffects:Array<()=>void>=[];let stateTables:any[]=fixture();let writes=0;
  let room='R';let queued=false;let queue:Array<(tables:any[])=>any[]>=[];let captures=0;let releases=0;
  const rect={left:10,top:20,width:800,height:600};
  const dom={getBoundingClientRect:()=>rect,setPointerCapture(){captures++;},hasPointerCapture:()=>true,releasePointerCapture(){releases++;}};
  const same=(a:any[],b:any[])=>a?.length===b?.length&&a.every((value,index)=>Object.is(value,b[index]));
  const react={createElement:(type:any,props:any,...children:any[])=>({type,props:{...props,children}}),
    useState:(initial:any)=>{const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return[slots[index],(value:any)=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];},
    useRef:(initial:any)=>{const index=cursor++;return slots[index]||=( {current:initial} );},
    useMemo:(fn:any,deps:any[])=>{const index=cursor++;if(!slots[index]||!same(slots[index].deps,deps))slots[index]={deps,value:fn()};return slots[index].value;},
    useEffect:(effect:any,deps:any[])=>{const index=cursor++;if(!slots[index]||!same(slots[index].deps,deps))pendingEffects.push(()=>{slots[index]?.cleanup?.();slots[index]={deps,cleanup:effect()};});},
  };
  (globalThis as any).__designerReact=react;const previousObserver=globalThis.ResizeObserver;
  (globalThis as any).ResizeObserver=class{observe(){}disconnect(){}};
  try {
    const result=await build({entryPoints:['components/TableLayoutDesigner.tsx'],bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'designer-react-fixture',setup(b){
      const mocks:Record<string,string>={react:'const r=globalThis.__designerReact;export default r;export const useState=r.useState,useRef=r.useRef,useMemo=r.useMemo,useEffect=r.useEffect;',
        'react/jsx-runtime':'export const jsx=(type,props)=>globalThis.__designerReact.createElement(type,props,...[].concat(props.children||[]));export const jsxs=jsx;export const Fragment="fragment";',
        'lucide-react':'export const Trash2=()=>null,Plus=Trash2,Layout=Trash2,Grid=Trash2,Settings=Trash2;'};
      b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'designer-fixture'}:undefined);
      b.onLoad({filter:/.*/,namespace:'designer-fixture'},a=>({contents:mocks[a.path],loader:'ts'}));
    }}]});
    const module={exports:{} as any};new Function('module','exports',result.outputFiles[0].text)(module,module.exports);
    const component=module.exports.default;
    const each=(node:any,fn:(node:any)=>void)=>{if(!node||typeof node!=='object')return;fn(node);for(const child of Array.isArray(node)?node:node.props?.children||[])each(child,fn);};
    const text=(node:any):string=>typeof node==='string'||typeof node==='number'?String(node):!node?'':(Array.isArray(node)?node:node.props?.children||[]).map(text).join('');
    const find=(tree:any,predicate:any)=>{let result:any;each(tree,node=>{if(!result&&predicate(node))result=node;});return result;};
    const update=(fn:any)=>{if(queued)queue.push(fn);else{const next=fn(stateTables);if(next!==stateTables)writes++;stateTables=next;}};
    const render=()=>{cursor=0;const tree=component({tables:stateTables,currentRoomId:room,rooms:[{id:'R',name:'Sala'},{id:'S',name:'Otra'}],onUpdateTables:update,onChangeRoom(){}});
      each(tree,node=>{if(node.props?.ref)node.props.ref.current=dom;});for(const effect of pendingEffects.splice(0))effect();return tree;};
    const event=(id:number,x:number,y:number)=>({pointerId:id,clientX:x,clientY:y,currentTarget:dom,stopPropagation(){},preventDefault(){}});
    const down=(tree:any,label:string,id=1)=>{const table=find(tree,(node:any)=>node.props?.onPointerDown&&text(node).includes(label));assert.ok(table,label);table.props.onPointerDown(event(id,rect.left+table.props.style.left+50,rect.top+table.props.style.top+50));return table;};
    const canvas=(tree:any)=>find(tree,(node:any)=>node.props?.onPointerMove);
    let tree=render();const original=stateTables.slice();const mesa12=down(tree,'Mesa 12');
    canvas(tree).props.onPointerMove(event(1,rect.left+mesa12.props.style.left+130,rect.top+mesa12.props.style.top+90));
    assert.equal(stateTables[11].posX,580);assert.equal(stateTables[11].posY,400);assert.ok(hasExplicitTableLayout(stateTables[11]));
    assert.equal(stateTables.length,12);for(let i=0;i<11;i++)assert.equal(stateTables[i],original[i]);
    assert.deepEqual(stateTables[11].metadata,original[11].metadata);assert.equal(stateTables[11].status,'FREE');
    const reopened=JSON.parse(JSON.stringify(stateTables));assert.equal(getRenderableFloorTables(reopened).find(t=>t.id==='t12')?.posX,580);
    tree=render();canvas(tree).props.onPointerUp(event(1,0,0));
    tree=render();const mesa4=down(tree,'Mesa 4');canvas(tree).props.onPointerMove(event(1,rect.left+mesa4.props.style.left+90,rect.top+mesa4.props.style.top+70));
    assert.equal(stateTables[3].posX,540);assert.equal(stateTables[3].posY,100);assert.equal(stateTables[3].shape,'CIRCLE');assert.equal(stateTables[3].rotation,15);
    canvas(tree).props.onPointerMove(event(1,99999,99999));assert.equal(stateTables[3].posX,700);assert.equal(stateTables[3].posY,500);
    canvas(tree).props.onPointerMove(event(1,-99999,-99999));assert.equal(stateTables[3].posX,0);assert.equal(stateTables[3].posY,0);
    canvas(tree).props.onPointerUp(event(1,0,0));
    // Alias-only and malformed raw geometry normalize only the dragged row.
    stateTables=fixture();delete stateTables[11].roomId;stateTables[11].room_id='R';stateTables[11].width='broken';stateTables[11].rotation=NaN;
    tree=render();const alias=down(tree,'Mesa 12');queued=true;
    canvas(tree).props.onPointerMove(event(1,rect.left+alias.props.style.left+70,rect.top+alias.props.style.top+70));
    stateTables=stateTables.map(t=>t.id==='t12'?{...t,status:'OCCUPIED',currentOrderId:'order-latest',currentOrderTotal:42.1234,editingLock:{owner:'other'},unknown:{keep:true}}:t);
    stateTables.push({id:'new',roomId:'S',name:'Mesa 20',status:'FREE'});
    queued=false;for(const fn of queue.splice(0))update(fn);
    const updated=stateTables.find(t=>t.id==='t12');assert.equal(updated.roomId,'R');assert.equal(updated.room_id,'R');assert.equal(updated.currentOrderTotal,42.1234);
    assert.equal(updated.currentOrderId,'order-latest');assert.deepEqual(updated.editingLock,{owner:'other'});assert.deepEqual(updated.unknown,{keep:true});assert.equal(stateTables.length,13);
    assert.equal(updated.width,100);assert.equal(updated.rotation,0);assert.ok(Number.isFinite(updated.posX));
    canvas(tree).props.onPointerUp(event(1,0,0));
    // Wrong pointer cannot cancel or move; matching cancel invalidates pending work.
    tree=render();down(tree,'Mesa 12',7);const before=stateTables;canvas(tree).props.onPointerMove(event(8,500,500));assert.equal(stateTables,before);
    canvas(tree).props.onPointerCancel(event(8,0,0));queued=true;canvas(tree).props.onPointerMove(event(7,600,500));canvas(tree).props.onPointerCancel(event(7,0,0));queued=false;
    for(const fn of queue.splice(0))update(fn);assert.equal(stateTables,before);
    // Room switch, removal, and unmount guard callbacks even before a queued update applies.
    tree=render();down(tree,'Mesa 12');const staleCanvas=canvas(tree);room='S';render();staleCanvas.props.onPointerMove(event(1,600,500));assert.equal(stateTables,before);room='R';
    tree=render();down(tree,'Mesa 12');stateTables=stateTables.filter(t=>t.id!=='t12');const removed=stateTables;canvas(tree).props.onPointerMove(event(1,600,500));assert.equal(stateTables,removed);
    stateTables=fixture();tree=render();down(tree,'Mesa 12');queued=true;canvas(tree).props.onPointerMove(event(1,600,500));for(const slot of slots)slot?.cleanup?.();queued=false;
    const atUnmount=stateTables;for(const fn of queue.splice(0))update(fn);assert.equal(stateTables,atUnmount);
    // Render-visible ambiguous originals must never be written, even when the normalizer shows one row.
    slots=[];pendingEffects=[];
    for(const bad of ['duplicate','conflict','blank']) {
      stateTables=fixture();
      if(bad==='duplicate')stateTables.push({...stateTables[11],roomId:'S'});
      if(bad==='conflict')stateTables[11].room_id='S';
      if(bad==='blank')stateTables[11].id='';
      tree=render();const before=stateTables;const row=down(tree,'Mesa 12');
      canvas(tree).props.onPointerMove(event(1,rect.left+row.props.style.left+90,rect.top+row.props.style.top+90));assert.equal(stateTables,before);
    }
    // A logical duplicate with a different UUID can supply visible geometry but never replace the original array.
    stateTables=fixture();stateTables.push({...stateTables[11],id:'operational',status:'OCCUPIED',currentOrderId:'existing'});
    tree=render();const beforeLogical=stateTables.slice();const logical=down(tree,'Mesa 12');
    canvas(tree).props.onPointerMove(event(1,rect.left+logical.props.style.left+90,rect.top+logical.props.style.top+90));
    assert.equal(stateTables.length,13);assert.equal(stateTables[11],beforeLogical[11]);assert.equal(stateTables[12].id,'operational');assert.equal(stateTables[12].currentOrderId,'existing');
    assert.ok(hasExplicitTableLayout(stateTables[12]));
    assert.ok(captures>0);assert.ok(releases>0);assert.ok(writes>0);
  }finally{delete (globalThis as any).__designerReact;globalThis.ResizeObserver=previousObserver;}
});

test('designer identities reject duplicate ids, missing ids and conflicting room aliases without removing original rows',()=>{
  const tables=fixture();assert.equal(uniqueDesignerTable([...tables,{...tables[11],roomId:'S'}], 't12','R'),undefined);
  assert.equal(uniqueDesignerTable([{...tables[11],room_id:'S'}], 't12','R'),undefined);
  assert.equal(uniqueDesignerTable([{...tables[11],roomId:42}], 't12','R'),undefined);
  assert.equal(uniqueDesignerTable([{...tables[11],id:''}], '','R'),undefined);
  assert.equal(uniqueDesignerTable(tables,'t12','S'),undefined);
});
