import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import SQLite from 'better-sqlite3';
import type { ArticleFormat, ArticleFormatsDTO } from '../services/articleFormats/contract';
import { ArticleFormatNetworkMaster, NETWORK_MASTER_DATASETS, type NetworkLinePolicy, type NetworkMasterDataset } from '../services/articleFormats/networkMaster';
import { ARTICLE_FORMAT_NETWORK_SCHEMA } from '../services/articleFormats/networkSchema';
import type { FormatSQL } from '../services/articleFormats/store';
import { hashText, type FormatTransport, type NetworkContext } from '../services/articleFormats/wire';
import { androidSQLiteStatements } from './nativeSQLiteParser';

// Synthetic authenticated transport fixtures, not an ERP/Android end-to-end claim.
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const context=():NetworkContext=>({contract:'ARTICLE_FORMATS',schema_version:1,ingress_version:1,master_contract_version:3,
  profile:'DOP_SETTLED_REALTIME_V1',variant_identity:'ERP_ID',grant_revision:1,
  scope:{tenantId:id(1),companyId:id(2),terminalId:id(3),warehouseId:id(4),storeId:id(5)},
  tariff_ids:[id(6)],return_policy:'RESTOCK',event_types:['ARTICLE_FORMAT_SALE_V1','ARTICLE_FORMAT_RETURN_V1','ARTICLE_FORMAT_VOID_V1'],
  events_url:'/api/sync/article-formats/v1/events',master_sessions_url:'/api/sync/v3/master-syncs'});
function format(variantId:string|null):ArticleFormat {
  return {schemaVersion:1,id:'unit',variantId,name:'Unidad',abbreviation:'UD',factor:1,
    barcode:variantId===null?null:'7501031311309',active:true,is_base:true,default_purchase:true,default_sale:true,
    allow_purchase:true,allow_sale:true,allow_transfer:true,sort_order:0,prices:[{tariffId:id(6),price:0}]};
}
const dto=(itemId=id(7)):ArticleFormatsDTO=>({schema_version:1,inventory_quantity_unit:'BASE',item_id:itemId,
  formats:[format(null),format(id(8))]});
const tax={id:id(9),rate:.18,type:'ITBIS',active:true};
const policy=(itemId=id(7)):NetworkLinePolicy=>({item_id:itemId,base_unit_cost:'3.123456',variant_ids:[id(8)],
  variant_skus:{[id(8)]:'RED-SKU'},base_prices:[{variant_id:null,tariff_id:id(6),price:'10',tax_included:false},
    {variant_id:id(8),tariff_id:id(6),price:'11',tax_included:false}],
  taxes:[tax],tax_rate:'0.18',max_discount_rate:'10',promotions:[],warehouse_id:id(4)});
const cursor=(index:number,end:string)=>Buffer.from(JSON.stringify({index,end})).toString('base64url');
type Fixture={manifest:any;chunks:Record<NetworkMasterDataset,string[]>;pages:any[]};
async function revision(syncId=id(20),version=2,options:{empty?:boolean;multi?:boolean}={}):Promise<Fixture>{
  const itemIds=options.empty?[]:options.multi?[id(7),id(10)]:[id(7)];
  const data:Record<NetworkMasterDataset,any[]>={
    articles:itemIds.map(itemId=>({id:itemId,name:'Fixture',article_formats:dto(itemId)})),
    prices:itemIds.map(articleId=>({articleId,tariffId:id(6),price:0})),
    tariffs:options.empty?[]:[{id:id(6),currency:'DOP',active:true,taxIncluded:false}],
    variants:itemIds.map(articleId=>({articleId,id:id(8),sku:'RED-SKU',active:true})),
    barcodes:itemIds.map(articleId=>({articleId,code:'7501031311309'})),
    taxes:options.empty?[]:[tax]
  };
  const chunks={} as Fixture['chunks'],datasets:any={},pages:any[]=[];
  for(const dataset of NETWORK_MASTER_DATASETS){
    chunks[dataset]=data[dataset].map((record,chunkIndex)=>JSON.stringify({schemaVersion:3,syncId,dataset,chunkIndex,records:[record]}));
    const hashes=await Promise.all(chunks[dataset].map(hashText));
    datasets[dataset]={count:data[dataset].length,chunks:chunks[dataset].length,
      bytes:chunks[dataset].reduce((n,raw)=>n+Buffer.byteLength(raw),0),gzipBytes:0,checksum:await hashText(hashes.join(''))};
    if(dataset==='articles')for(let index=0;index<itemIds.length;index++)pages.push({
      scope:{tenantId:id(1),companyId:id(2)},pageId:`${syncId}:articles:${index}`,revision:version,
      nextCursor:index+1<itemIds.length?cursor(index+1,itemIds[index]):null,
      items:[dto(itemIds[index])],linePolicies:[policy(itemIds[index])],checksum:hashes[index]
    });
  }
  const base=`/api/sync/v3/master-syncs/${syncId}`;
  return {chunks,pages,manifest:{syncId,syncVersion:version,schemaVersion:3,contractVersion:3,type:'FULL',status:'READY',datasets,
    articleFormats:{schemaVersion:1,variantIdentity:'ERP_ID',acknowledgeAllDatasets:true,pagesUrl:base+'/article-formats/pages',
      ackUrl:base+'/ack',completeUrl:base+'/complete',revision_checksum:'a'.repeat(64)}}};
}
async function local(t:test.TestContext,fixtures:Fixture[]){
  const folder=mkdtempSync(join(tmpdir(),'clic-network-master-')),file=join(folder,'local.sqlite');
  let db=new SQLite(file);db.pragma('foreign_keys=ON');
  t.after(()=>{if(db.open)db.close();rmSync(folder,{recursive:true,force:true});});
  let failLocalActivation=false;
  const sql:FormatSQL={executeSchema:async text=>{db.exec(text);},query:async<T>(text:string,values:(string|number|null)[])=>db.prepare(text).all(...values) as T[],
    executeAtomic:async statements=>{
      if(failLocalActivation&&statements.some(s=>s.statement.includes("SET state='COMPLETE'"))){failLocalActivation=false;throw Error('synthetic activation crash');}
      db.transaction(()=>{for(const statement of statements)db.prepare(statement.statement).run(...(statement.values||[]));})();
    }};
  const acknowledgements:any[]=[],completions:any[]=[],requests:string[]=[];
  const serverACKs=new Map<string,any>(),serverCompletions=new Map<string,any>();
  const sessions=new Map(fixtures.map(f=>[f.manifest.syncId,f]));
  let loseACK=false,loseComplete=false;
  let transformPage:(page:any)=>any=page=>page;
  let transformRaw:(raw:string,dataset:NetworkMasterDataset,index:number)=>unknown=raw=>raw;
  let transformComplete:(receipt:any)=>any=receipt=>receipt;
  const transport:FormatTransport={async request(path,body?:any){
    requests.push(path);
    const url=new URL(path,'http://fixture.invalid');
    if(url.pathname==='/api/sync/v3/master-syncs')return {schemaVersion:3,contractVersion:3,syncId:fixtures[0].manifest.syncId};
    const parts=url.pathname.split('/'),syncId=parts[5],f=sessions.get(syncId);assert.ok(f,'request must use its exact fixture session');
    if(path.endsWith('/manifest'))return structuredClone(f.manifest);
    if(parts[6]==='datasets'){const dataset=parts[7] as NetworkMasterDataset,index=Number(parts[9]);return transformRaw(f.chunks[dataset][index],dataset,index);}
    if(parts[6]==='article-formats'){
      const supplied=url.searchParams.get('cursor');
      const index=supplied===null?0:JSON.parse(Buffer.from(supplied,'base64url').toString()).index;
      assert.equal(supplied,index===0?null:f.pages[index-1].nextCursor,'cursor must originate from previous chunk of this session');
      return transformPage(structuredClone(f.pages[index]));
    }
    if(path.endsWith('/ack')){
      acknowledgements.push(structuredClone(body));
      const [,dataset,index]=body.page_id.split(':');
      const row=db.prepare('SELECT raw_text,checksum,next_cursor FROM article_format_network_chunks WHERE sync_id=? AND dataset=? AND chunk_index=?').get(syncId,dataset,Number(index)) as any;
      assert.ok(row,'chunk must be durable before ACK');assert.equal(await hashText(row.raw_text),row.checksum);assert.equal(row.next_cursor,body.next_cursor);
      assert.equal((db.prepare('SELECT verified FROM article_format_network_datasets WHERE sync_id=? AND dataset=?').get(syncId,dataset) as any).verified,1);
      const receipt={...body,acknowledged:true};
      if(serverACKs.has(body.page_id))assert.deepEqual(serverACKs.get(body.page_id),receipt);else serverACKs.set(body.page_id,receipt);
      if(loseACK){loseACK=false;throw Error('synthetic lost ACK response');}return structuredClone(receipt);
    }
    if(path.endsWith('/complete')){
      completions.push(structuredClone(body));
      const rows=db.prepare('SELECT dataset,verified FROM article_format_network_datasets WHERE sync_id=?').all(syncId) as any[];
      assert.equal(rows.length,6);assert.ok(rows.every(row=>row.verified===1),'all six replacements including empties must be durable');
      assert.equal((db.prepare('SELECT count(*) n FROM article_format_network_chunks WHERE sync_id=? AND ack_receipt IS NULL').get(syncId) as any).n,0);
      const receipt={...body,complete:true};if(serverCompletions.has(syncId))assert.deepEqual(serverCompletions.get(syncId),receipt);else serverCompletions.set(syncId,receipt);
      if(loseComplete){loseComplete=false;throw Error('synthetic lost complete response');}return transformComplete(structuredClone(receipt));
    }
    throw Error('unexpected fixture path');
  }};
  const master=(ctx=context())=>new ArticleFormatNetworkMaster(sql,ctx,transport);
  return {master,sql,transport,requests,acknowledgements,completions,serverACKs,serverCompletions,
    database:()=>db,reopen:()=>{db.close();db=new SQLite(file);db.pragma('foreign_keys=ON');},
    loseACK:()=>{loseACK=true;},loseComplete:()=>{loseComplete=true;},failActivation:()=>{failLocalActivation=true;},
    changePage:(fn:typeof transformPage)=>{transformPage=fn;},changeRaw:(fn:typeof transformRaw)=>{transformRaw=fn;},
    changeComplete:(fn:typeof transformComplete)=>{transformComplete=fn;}};
}

test('network schema executes through the actual Android Java SQL parser',t=>{
  const db=new SQLite(':memory:');t.after(()=>db.close());
  for(const statement of androidSQLiteStatements(ARTICLE_FORMAT_NETWORK_SCHEMA,t))db.exec(statement);
  assert.equal((db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get() as any).n,5);
});

test('staging stays invisible and incomplete six-dataset state never sends complete',async t=>{
  const f=await revision(),env=await local(t,[f]),master=env.master();await master.migrate();await master.stageManifest(f.manifest);
  assert.equal((await master.getStagingRevision())?.syncId,f.manifest.syncId);assert.equal(await master.getActiveRevision(),undefined);
  assert.equal(await master.getMaster(id(7)),undefined);assert.deepEqual(await master.getDataset('articles'),[]);
  await assert.rejects(master.complete(f.manifest.syncId),/POS_FORMAT_REVISION_INCOMPLETE/);assert.equal(env.completions.length,0);
});

test('all six empty datasets are durable before complete and replace current reads while preserving history',async t=>{
  const a=await revision(),b=await revision(id(21),3,{empty:true}),env=await local(t,[a,b]);
  await env.master().download(a.manifest.syncId);await env.master().download(b.manifest.syncId);
  assert.equal(env.serverACKs.size,6); // Empty replacements have no fictional chunks or ACKs.
  for(const dataset of NETWORK_MASTER_DATASETS)assert.deepEqual(await env.master().getDataset(dataset),[]);
  assert.equal(await env.master().getMaster(id(7)),undefined);
  assert.deepEqual((await env.master().getPolicy(id(7),a.manifest.syncId,2))?.dto,dto());
  await env.master().complete(a.manifest.syncId);assert.equal((await env.master().getActiveRevision())?.revision,3);
});

test('corrupt article dataset summary causes no ACK or complete',async t=>{
  const f=await revision();f.manifest.datasets.articles.checksum='b'.repeat(64);const env=await local(t,[f]);
  await assert.rejects(env.master().download(f.manifest.syncId),/POS_FORMAT_DATASET_CHECKSUM_INVALID/);
  assert.equal(env.acknowledgements.length,0);assert.equal(env.completions.length,0);assert.equal(await env.master().getActiveRevision(),undefined);
});

test('raw chunk bytes, not parsed or reordered JSON, determine integrity',async t=>{
  const f=await revision(),env=await local(t,[f]);env.changeRaw(raw=>' '+raw);
  await assert.rejects(env.master().download(f.manifest.syncId),/POS_FORMAT_PAGE_CORRUPT/);
  assert.equal(env.acknowledgements.length,0);
});

test('two-page opaque cursors use exact previous source cursor and retries reuse the same receipt',async t=>{
  const f=await revision(id(20),2,{multi:true}),env=await local(t,[f]);env.loseACK();
  await assert.rejects(env.master().download(f.manifest.syncId),/synthetic lost ACK/);
  assert.equal(await env.master().getActiveRevision(),undefined);env.reopen();await env.master().download();
  assert.equal((await env.master().getDataset('articles')).length,2);
  assert.deepEqual(env.acknowledgements[0],env.acknowledgements[1]);
  const firstArticle=env.acknowledgements.find(a=>a.page_id===`${f.manifest.syncId}:articles:0`);
  assert.equal(firstArticle.next_cursor,cursor(1,id(7)));
  assert.equal(env.serverACKs.size,10);assert.equal(env.serverCompletions.size,1);
});

test('foreign session page, revision, scope and incorrect next cursor fail before durable chunk or ACK',async t=>{
  for(const transform of [
    (p:any)=>({...p,pageId:`${id(99)}:articles:0`}),
    (p:any)=>({...p,revision:p.revision+1}),
    (p:any)=>({...p,scope:{...p.scope,companyId:id(99)}}),
    (p:any)=>({...p,nextCursor:cursor(1,id(99))})
  ]){
    const f=await revision(id(20),2,{multi:true}),env=await local(t,[f]);env.changePage(transform);
    await assert.rejects(env.master().download(f.manifest.syncId),/POS_FORMAT_PAGE_CORRUPT/);
    assert.equal((env.database().prepare('SELECT count(*) n FROM article_format_network_chunks').get() as any).n,0);
    assert.equal(env.acknowledgements.length,0);
  }
});

test('manifest cannot import a foreign session endpoint and repeated changed revision conflicts',async t=>{
  const f=await revision(),env=await local(t,[f]),master=env.master();await master.migrate();
  await assert.rejects(master.stageManifest({...f.manifest,articleFormats:{...f.manifest.articleFormats,ackUrl:`/api/sync/v3/master-syncs/${id(99)}/ack`}}),/POS_FORMAT_MANIFEST_INVALID/);
  await master.stageManifest(f.manifest);await master.stageManifest(f.manifest);
  await assert.rejects(master.stageManifest({...f.manifest,syncVersion:3}),/POS_FORMAT_SESSION_CONFLICT/);
});

test('lost complete response survives a physical SQLite close and reopens without exposing staging',async t=>{
  const f=await revision(),env=await local(t,[f]);env.loseComplete();
  await assert.rejects(env.master().download(f.manifest.syncId),/synthetic lost complete/);
  assert.equal(env.serverCompletions.size,1);assert.equal(await env.master().getActiveRevision(),undefined);
  assert.equal((env.database().prepare('SELECT state FROM article_format_network_sessions').get() as any).state,'LOCAL_READY');
  env.reopen();await env.master().complete(f.manifest.syncId);
  assert.equal(env.serverCompletions.size,1);assert.equal(env.completions.length,2);assert.equal((await env.master().getActiveRevision())?.syncId,f.manifest.syncId);
});

test('crash after remote completion before activation recovers one complete receipt after reopening',async t=>{
  const f=await revision(),env=await local(t,[f]);env.failActivation();
  await assert.rejects(env.master().download(f.manifest.syncId),/synthetic activation crash/);
  assert.equal(await env.master().getActiveRevision(),undefined);env.reopen();await env.master().complete(f.manifest.syncId);
  assert.equal(env.serverCompletions.size,1);assert.equal((await env.master().getActiveRevision())?.revision,2);
});

test('HTTP success with a conflicting complete receipt never activates',async t=>{
  const f=await revision(),env=await local(t,[f]);env.changeComplete(r=>({...r,revision_checksum:'b'.repeat(64)}));
  await assert.rejects(env.master().download(f.manifest.syncId),/POS_FORMAT_COMPLETE_INVALID/);
  assert.equal(await env.master().getActiveRevision(),undefined);
});

test('ERP variant ID, informational SKU mapping, barcode, zero tariff price and historical grant remain exact',async t=>{
  const f=await revision(),env=await local(t,[f]);await env.master().download(f.manifest.syncId);
  const master=env.master(),historical=await master.getPolicy(id(7));assert.ok(historical);
  assert.equal(historical.dto.formats[1].variantId,id(8));assert.equal(historical.dto.formats[1].prices[0].price,0);
  assert.equal(historical.policy.variant_skus[id(8)],'RED-SKU');assert.equal(historical.policy.base_unit_cost,'3.123456');
  assert.equal((await master.getDataset<any>('variants'))[0].id,id(8));assert.equal((await master.getDataset<any>('variants'))[0].sku,'RED-SKU');
  assert.equal((await master.getDataset<any>('barcodes'))[0].code,'7501031311309');assert.equal((await master.getDataset<any>('prices'))[0].price,0);
  const changed=context();changed.grant_revision=2;const newGrant=env.master(changed);
  assert.equal(await newGrant.getActiveRevision(),undefined);assert.equal(await newGrant.getPolicy(id(7)),undefined);
  assert.deepEqual(await newGrant.getPolicy(id(7),f.manifest.syncId,2),historical);
  await assert.rejects(newGrant.complete(f.manifest.syncId),/POS_FORMAT_SESSION_SCOPE_MISMATCH/);
  const other=context();other.scope.terminalId=id(99);await assert.rejects(env.master(other).getPolicy(id(7),f.manifest.syncId,2),/POS_FORMAT_REVISION_INCOMPLETE/);
});
