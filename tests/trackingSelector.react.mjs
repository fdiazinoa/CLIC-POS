import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const runtime=process.env.CLIC_ROUTING_REACT_TEST_RUNTIME;
if(!runtime)throw Error('CLIC_ROUTING_REACT_TEST_RUNTIME_REQUIRED');
const require=createRequire(runtime+'/package.json'),React=require('react'),Renderer=require('react-test-renderer');
globalThis.__trackingReact=React;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let legacyReads=0;
globalThis.__trackingLegacy=()=>{legacyReads++;throw Error('LEGACY_READ_FORBIDDEN');};
const built=await build({entryPoints:['components/TrackingSelectionModal.tsx'],bundle:true,write:false,platform:'node',format:'cjs',jsx:'transform',plugins:[{name:'ports',setup(b){b.onResolve({filter:/^(react|lucide-react)$/},a=>({path:a.path,namespace:'ports'}));b.onResolve({filter:/utils\/db$/},()=>({path:'db',namespace:'ports'}));b.onLoad({filter:/.*/,namespace:'ports'},a=>({contents:a.path==='react'?'module.exports=globalThis.__trackingReact;module.exports.default=module.exports;':a.path==='db'?'exports.db={get:globalThis.__trackingLegacy};':['X','Calendar','ScanBarcode','Check','AlertCircle','Search'].map(n=>`exports.${n}=()=>null;`).join('')}));}}]});
const m={exports:{}};new Function('module','exports',built.outputFiles[0].text)(m,m.exports);const Modal=m.exports.default;
const text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join(' ');
const {act}=React;
for(const test of [{name:'split lot',flags:{usesLots:true},quantity:.125,amounts:[25000,100000],codes:['LOT-A','LOT-B']},{name:'micro lot',flags:{usesLots:true},quantity:.000001,amounts:[1],codes:['MICRO']},{name:'serial',flags:{usesSerial:true},quantity:1,amounts:[1000000],codes:['SERIAL']},{name:'serial linked lot',flags:{usesLots:true,usesSerial:true},quantity:1,amounts:[1000000],codes:['LOT-SERIAL']}]){
 let result;const options=test.codes.map((code,i)=>({id:code,productId:'item',warehouseId:'warehouse',status:'AVAILABLE',trackingCode:code,availableMinor:test.amounts[i],v3Authority:{kind:test.flags.usesSerial?'SERIAL':'LOT'}}));
 let renderer;await act(async()=>{renderer=Renderer.create(React.createElement(Modal,{product:{id:'item',name:'Tracked',operationalFlags:test.flags},warehouseId:'warehouse',quantity:test.quantity,loadOptions:async()=>options,onSelect:value=>{result=value;},onClose:()=>{}}));});
 for(const code of test.codes){const row=renderer.root.findAllByType('div').find(n=>n.props.onClick&&text(n).includes(code));assert.ok(row);await act(async()=>row.props.onClick());}
 const confirm=renderer.root.findAllByType('button').find(n=>text(n).includes('Confirmar'));assert.equal(confirm.props.disabled,false,test.name);await act(async()=>confirm.props.onClick());assert.deepEqual(result.map(r=>r.selectedQuantityMinor),test.amounts,test.name);
 await act(async()=>renderer.unmount());
}
assert.equal(legacyReads,0);console.log('PASS actual React selector: split lots, micro quantity, serial, serial with lot; no legacy reads');
