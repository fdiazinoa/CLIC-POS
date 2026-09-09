import fs from 'node:fs';
import path from 'node:path';
import {TraceMap,originalPositionFor} from '@jridgewell/trace-mapping';
const [folder,assets]=process.argv.slice(2);const ops=JSON.parse(fs.readFileSync(path.join(folder,'selective-operations.json')));const cache=new Map();
function resolve(f){if(!f.url||!f.line)return f;const name=f.url.split('/').pop();const file=path.join(assets,name+'.map');if(!fs.existsSync(file))return f;if(!cache.has(file))cache.set(file,new TraceMap(JSON.parse(fs.readFileSync(file))));const map=cache.get(file),pos=originalPositionFor(map,{line:f.line,column:Math.max(0,f.column-1)});return {...f,mappedPosition:pos,mappingWarning:"AST-instrumented files map to transformed source lines; resolve with inspect-transformed.ts before citing original source"};}
for(const o of ops)for(const s of o.sampledStacks)s.stack=s.stack.map(resolve);
fs.writeFileSync(path.join(folder,'resolved-operations.json'),JSON.stringify(ops,null,2));
for(const o of ops.sort((a,b)=>(b.firstRenderMs||0)-(a.firstRenderMs||0)).slice(0,2)){console.log(o.traceId,o.firstRenderMs);for(const s of o.sampledStacks.slice(0,8))console.log(s.count,JSON.stringify(s.stack.slice(0,5)));}
