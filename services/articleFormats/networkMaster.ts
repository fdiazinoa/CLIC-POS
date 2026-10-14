import type { ArticleFormatsDTO } from './contract';
import { validateDTO } from './domain';
import { canonicalContent, type FormatSQL, type FormatStatement } from './store';
import { ARTICLE_FORMAT_NETWORK_SCHEMA } from './networkSchema';
import { decimal, hashText, Money, requireFormat, uuid, validateContext, type FormatTransport, type NetworkContext } from './wire';

export const NETWORK_MASTER_DATASETS = ['articles','prices','tariffs','variants','barcodes','taxes'] as const;
export type NetworkMasterDataset = typeof NETWORK_MASTER_DATASETS[number];
export interface NetworkLinePolicy {
  item_id: string; base_unit_cost: string; variant_ids: string[]; variant_skus: Record<string,string|null>;
  base_prices: {variant_id:string|null;tariff_id:string;price:string;tax_included:boolean}[];
  taxes: {id:string;rate:number;type:string;[key:string]:unknown}[];
  tax_rate: string; max_discount_rate: string; promotions: Record<string,unknown>[]; warehouse_id: string;
}
export interface NetworkMasterRevision { syncId:string;revision:number;context:NetworkContext;revisionChecksum:string }
export interface NetworkHistoricalPolicy { dto:ArticleFormatsDTO;policy:NetworkLinePolicy }
interface Summary {count:number;chunks:number;bytes:number;gzipBytes:number;checksum:string}
interface Manifest {
  syncId:string;syncVersion:number;schemaVersion:3;contractVersion:3;type:'FULL';status:'READY';
  datasets:Record<NetworkMasterDataset,Summary>;
  articleFormats:{schemaVersion:1;variantIdentity:'ERP_ID';acknowledgeAllDatasets:true;
    pagesUrl:string;ackUrl:string;completeUrl:string;revision_checksum:string};
}
interface Session {sync_id:string;revision:number;context:string;manifest:string;revision_checksum:string;state:string}
interface Chunk {schemaVersion:3;syncId:string;dataset:NetworkMasterDataset;chunkIndex:number;records:Record<string,any>[]}
const sha = (value:unknown) => typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const insert = (table:string, columns:string, values:(string|number|null)[]):FormatStatement => ({
  statement:`INSERT OR IGNORE INTO ${table} (${columns}) VALUES (${values.map(()=>'?').join(',')})`,values
});
const scopeColumns='tenant_id,company_id,terminal_id';
const sessionColumns=`${scopeColumns},sync_id`;
const whereScope='tenant_id=? AND company_id=? AND terminal_id=?';
const whereSession=`${whereScope} AND sync_id=?`;
const encodeCursor = (index:number,end:string):string => btoa(unescape(encodeURIComponent(JSON.stringify({index,end}))))
  .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function freezeJSON<T>(value:T):T {
  if(value&&typeof value==='object'){Object.values(value).forEach(freezeJSON);Object.freeze(value);}return value;
}
function recordCursor(dataset:NetworkMasterDataset,record:Record<string,any>):string {
  let fields:unknown[];
  if(dataset==='prices')fields=[record.articleId,record.tariffId];
  else if(dataset==='variants')fields=[record.articleId,record.id];
  else if(dataset==='barcodes')fields=[record.articleId,record.code];
  else fields=[record.id];
  requireFormat(fields.every(value=>typeof value==='string'&&value.length>0),'POS_FORMAT_PAGE_CORRUPT');
  return fields.join('::');
}

/** Contract 3 staging is invisible to checkout until complete has a validated durable receipt.
 * The six datasets live in this snapshot store, including their empty replacements.
 * Callers hydrate their bounded catalog pages from getDataset/getMaster, never legacy latest-revision tables.
 */
export class ArticleFormatNetworkMaster {
  readonly context:NetworkContext;
  private inFlight:Promise<NetworkMasterRevision>|undefined;
  private inFlightSyncId:string|undefined;
  constructor(private readonly sql:FormatSQL, negotiated:NetworkContext, private readonly transport:FormatTransport) {
    this.context=freezeJSON(validateContext(negotiated));
  }
  migrate():Promise<void>{return this.sql.executeSchema(ARTICLE_FORMAT_NETWORK_SCHEMA);}
  private scope():[string,string,string]{return [this.context.scope.tenantId,this.context.scope.companyId,this.context.scope.terminalId];}
  private values(syncId:string):(string|number|null)[]{return [...this.scope(),syncId];}
  private path(syncId:string):string{uuid(syncId);return `${this.context.master_sessions_url}/${syncId}`;}
  private async session(syncId:string):Promise<Session>{
    uuid(syncId);
    const rows=await this.sql.query<Session>(`SELECT * FROM article_format_network_sessions WHERE ${whereSession}`,this.values(syncId));
    requireFormat(rows.length===1&&rows[0].context===canonicalContent(this.context),'POS_FORMAT_SESSION_SCOPE_MISMATCH');
    return rows[0];
  }
  private revision(row:Session):NetworkMasterRevision{
    return {syncId:row.sync_id,revision:row.revision,context:JSON.parse(row.context),revisionChecksum:row.revision_checksum};
  }
  async getActiveRevision():Promise<NetworkMasterRevision|undefined>{
    const rows=await this.sql.query<Session>(`SELECT s.* FROM article_format_network_sessions s
      JOIN article_format_network_active a ON a.tenant_id=s.tenant_id AND a.company_id=s.company_id
       AND a.terminal_id=s.terminal_id AND a.sync_id=s.sync_id AND a.revision=s.revision
      WHERE s.tenant_id=? AND s.company_id=? AND s.terminal_id=? AND s.context=? AND s.state='COMPLETE'`,
      [...this.scope(),canonicalContent(this.context)]);
    return rows[0]?this.revision(rows[0]):undefined;
  }
  async getStagingRevision():Promise<NetworkMasterRevision|undefined>{
    const rows=await this.sql.query<Session>(`SELECT * FROM article_format_network_sessions WHERE ${whereScope}
      AND context=? AND state<>'COMPLETE' ORDER BY revision DESC LIMIT 1`,[...this.scope(),canonicalContent(this.context)]);
    return rows[0]?this.revision(rows[0]):undefined;
  }
  async getPolicy(itemId:string,syncId?:string,revision?:number):Promise<NetworkHistoricalPolicy|undefined>{
    uuid(itemId);
    if(!syncId){const active=await this.getActiveRevision();if(!active)return undefined;syncId=active.syncId;revision=active.revision;}
    uuid(syncId);
    // Explicit historical lookup retains the original grant's prices/snapshot. It grants no current admission.
    const sessions=await this.sql.query<Session>(`SELECT * FROM article_format_network_sessions WHERE ${whereSession}`,this.values(syncId));
    const session=sessions[0];requireFormat(session,'POS_FORMAT_REVISION_INCOMPLETE');
    requireFormat(session.state==='COMPLETE'&&(revision===undefined||revision===session.revision),'POS_FORMAT_REVISION_INCOMPLETE');
    const rows=await this.sql.query<{dto:string;policy:string}>(`SELECT dto,policy FROM article_format_network_policies WHERE ${whereSession} AND item_id=?`,[...this.values(syncId),itemId]);
    return rows[0]?{dto:JSON.parse(rows[0].dto),policy:JSON.parse(rows[0].policy)}:undefined;
  }
  async getMaster(itemId:string):Promise<ArticleFormatsDTO|undefined>{return (await this.getPolicy(itemId))?.dto;}
  async getDataset<T=Record<string,unknown>>(dataset:NetworkMasterDataset):Promise<T[]>{
    requireFormat(NETWORK_MASTER_DATASETS.includes(dataset),'POS_FORMAT_DATASET_INVALID');
    const active=await this.getActiveRevision();if(!active)return [];
    const rows=await this.sql.query<{raw_text:string}>(`SELECT raw_text FROM article_format_network_chunks
      WHERE ${whereSession} AND dataset=? ORDER BY chunk_index`,[...this.values(active.syncId),dataset]);
    return rows.flatMap(row=>(JSON.parse(row.raw_text) as Chunk).records) as T[];
  }
  async stageManifest(input:unknown):Promise<NetworkMasterRevision>{
    const m=structuredClone(input) as Manifest;
    requireFormat(m?.status==='READY','POS_FORMAT_SESSION_NOT_READY');uuid(m.syncId);
    requireFormat(m.schemaVersion===3&&m.contractVersion===3&&m.type==='FULL'
      &&Number.isSafeInteger(m.syncVersion)&&m.syncVersion>0,'POS_FORMAT_MANIFEST_INVALID');
    const base=this.path(m.syncId),f=m.articleFormats;
    requireFormat(f?.schemaVersion===1&&f.variantIdentity==='ERP_ID'&&f.acknowledgeAllDatasets===true
      &&sha(f.revision_checksum)&&f.pagesUrl===`${base}/article-formats/pages`
      &&f.ackUrl===`${base}/ack`&&f.completeUrl===`${base}/complete`,'POS_FORMAT_MANIFEST_INVALID');
    requireFormat(m.datasets&&Object.keys(m.datasets).length===6,'POS_FORMAT_MANIFEST_INVALID');
    for(const dataset of NETWORK_MASTER_DATASETS){
      const summary=m.datasets[dataset];
      requireFormat(summary&&[summary.count,summary.chunks,summary.bytes,summary.gzipBytes].every(n=>Number.isSafeInteger(n)&&n>=0)
        &&summary.chunks<=1000000&&sha(summary.checksum)
        &&((summary.count===0&&summary.chunks===0&&summary.bytes===0)||(summary.count>0&&summary.chunks>0&&summary.bytes>0)),
        'POS_FORMAT_MANIFEST_INVALID');
    }
    await this.sql.executeAtomic([
      insert('article_format_network_sessions',`${sessionColumns},revision,context,manifest,revision_checksum`,
        [...this.values(m.syncId),m.syncVersion,canonicalContent(this.context),canonicalContent(m),f.revision_checksum]),
      ...NETWORK_MASTER_DATASETS.map(dataset=>insert('article_format_network_datasets',`${sessionColumns},dataset`,[...this.values(m.syncId),dataset]))
    ]);
    return this.revision(await this.session(m.syncId));
  }
  private validatePolicy(dto:ArticleFormatsDTO,p:NetworkLinePolicy):NetworkLinePolicy {
    requireFormat(p&&p.item_id===dto.item_id&&p.warehouse_id===this.context.scope.warehouseId,'POS_FORMAT_POLICY_SCOPE_MISMATCH');
    decimal(p.base_unit_cost,6);decimal(p.tax_rate,50);requireFormat(new Money(p.tax_rate).lte(1),'POS_FORMAT_POLICY_INVALID');
    requireFormat(decimal(p.max_discount_rate,4).lte(100),'POS_FORMAT_POLICY_INVALID');
    requireFormat(Array.isArray(p.variant_ids)&&new Set(p.variant_ids).size===p.variant_ids.length
      &&p.variant_ids.every(id=>typeof id==='string'&&id.length>0)&&p.variant_skus&&typeof p.variant_skus==='object','POS_FORMAT_POLICY_INVALID');
    const variants=[null,...p.variant_ids];
    requireFormat(dto.formats.every(f=>variants.includes(f.variantId))&&Array.isArray(p.base_prices)
      &&p.base_prices.length===variants.length*this.context.tariff_ids.length,'POS_FORMAT_POLICY_INVALID');
    const prices=new Set<string>();
    for(const price of p.base_prices){
      const key=JSON.stringify([price.variant_id,price.tariff_id]);
      requireFormat(variants.includes(price.variant_id)&&this.context.tariff_ids.includes(price.tariff_id)
        &&typeof price.tax_included==='boolean'&&!prices.has(key),'POS_FORMAT_POLICY_INVALID');
      decimal(price.price,4);prices.add(key);
    }
    requireFormat(Array.isArray(p.taxes)&&Array.isArray(p.promotions),'POS_FORMAT_POLICY_INVALID');
    let tax=new Money(0);const ids=new Set<string>();
    for(const entry of p.taxes){uuid(entry.id);requireFormat(!ids.has(entry.id)&&entry.type==='ITBIS'
      &&typeof entry.rate==='number'&&Number.isFinite(entry.rate)&&entry.rate>=0&&entry.rate<=1,'POS_FORMAT_POLICY_INVALID');
      ids.add(entry.id);tax=tax.plus(String(entry.rate));}
    requireFormat(tax.eq(p.tax_rate),'POS_FORMAT_POLICY_INVALID');
    return structuredClone(p);
  }
  private async stageChunk(m:Manifest,dataset:NetworkMasterDataset,index:number,raw:unknown,cursor:string|null):Promise<string|null>{
    requireFormat(typeof raw==='string','POS_FORMAT_RAW_CHUNK_REQUIRED');
    requireFormat(new TextEncoder().encode(raw).length<=4194304,'POS_FORMAT_PAGE_TOO_LARGE');
    let chunk:Chunk;try{chunk=JSON.parse(raw);}catch{requireFormat(false,'POS_FORMAT_PAGE_CORRUPT');}
    requireFormat(chunk?.schemaVersion===3&&chunk.syncId===m.syncId&&chunk.dataset===dataset&&chunk.chunkIndex===index
      &&Array.isArray(chunk.records)&&chunk.records.length>0&&chunk.records.length<=1000,'POS_FORMAT_PAGE_CORRUPT');
    const checksum=await hashText(raw);
    const next=index+1<m.datasets[dataset].chunks?encodeCursor(index+1,recordCursor(dataset,chunk.records.at(-1))):null;
    let page:any=null;const policies:FormatStatement[]=[];
    if(dataset==='articles'){
      page=await this.transport.request(`${m.articleFormats.pagesUrl}${cursor===null?'':`?cursor=${encodeURIComponent(cursor)}`}`);
      requireFormat(page?.scope?.tenantId===this.context.scope.tenantId&&page.scope.companyId===this.context.scope.companyId
        &&page.pageId===`${m.syncId}:articles:${index}`&&page.revision===m.syncVersion&&page.checksum===checksum&&page.nextCursor===next
        &&Array.isArray(page.items)&&Array.isArray(page.linePolicies)&&page.items.length===chunk.records.length
        &&page.linePolicies.length===chunk.records.length,'POS_FORMAT_PAGE_CORRUPT');
      const itemIds=new Set<string>(),policyIds=new Set<string>();
      for(const p of page.linePolicies){requireFormat(p&&!policyIds.has(p.item_id),'POS_FORMAT_POLICY_CONFLICT');policyIds.add(p.item_id);}
      for(let i=0;i<page.items.length;i++){
        const dto=validateDTO(page.items[i],this.context.tariff_ids);uuid(dto.item_id);
        requireFormat(!itemIds.has(dto.item_id)&&chunk.records[i].id===dto.item_id
          &&canonicalContent(chunk.records[i].article_formats)===canonicalContent(dto),'POS_FORMAT_PAGE_CORRUPT');itemIds.add(dto.item_id);
        const policy=this.validatePolicy(dto,page.linePolicies.find((p:NetworkLinePolicy)=>p.item_id===dto.item_id));
        policies.push(insert('article_format_network_policies',`${sessionColumns},item_id,dto,policy`,
          [...this.values(m.syncId),dto.item_id,canonicalContent(dto),canonicalContent(policy)]));
      }
    }
    await this.sql.executeAtomic([
      insert('article_format_network_chunks',`${sessionColumns},dataset,chunk_index,raw_text,checksum,next_cursor,page_content`,
        [...this.values(m.syncId),dataset,index,raw,checksum,next,page===null?null:canonicalContent(page)]),...policies
    ]);
    return next;
  }
  private async verifyDataset(m:Manifest,dataset:NetworkMasterDataset,requireACK=false):Promise<void>{
    const rows=await this.sql.query<{chunk_index:number;raw_text:string;checksum:string;next_cursor:string|null;ack_receipt:string|null}>(
      `SELECT chunk_index,raw_text,checksum,next_cursor,ack_receipt FROM article_format_network_chunks WHERE ${whereSession} AND dataset=? ORDER BY chunk_index`,[...this.values(m.syncId),dataset]);
    const summary=m.datasets[dataset];requireFormat(rows.length===summary.chunks,'POS_FORMAT_REVISION_INCOMPLETE');
    let count=0,bytes=0;const identities=new Set<string>();
    for(let index=0;index<rows.length;index++){
      const row=rows[index],chunk=JSON.parse(row.raw_text) as Chunk;
      requireFormat(row.chunk_index===index&&(!requireACK||row.ack_receipt!==null)&&await hashText(row.raw_text)===row.checksum,'POS_FORMAT_REVISION_INCOMPLETE');
      const next=index+1<rows.length?encodeCursor(index+1,recordCursor(dataset,chunk.records.at(-1))):null;
      requireFormat(row.next_cursor===next,'POS_FORMAT_CURSOR_INVALID');
      for(const record of chunk.records){const identity=recordCursor(dataset,record);requireFormat(!identities.has(identity),'POS_FORMAT_RECORD_DUPLICATE');identities.add(identity);}
      count+=chunk.records.length;bytes+=new TextEncoder().encode(row.raw_text).length;
    }
    requireFormat(count===summary.count&&bytes===summary.bytes&&await hashText(rows.map(r=>r.checksum).join(''))===summary.checksum,'POS_FORMAT_DATASET_CHECKSUM_INVALID');
    await this.sql.executeAtomic([{statement:`UPDATE article_format_network_datasets SET verified=1 WHERE ${whereSession} AND dataset=?`,values:[...this.values(m.syncId),dataset]}]);
  }
  private async acknowledgeDataset(m:Manifest,dataset:NetworkMasterDataset):Promise<void>{
    const rows=await this.sql.query<{chunk_index:number;checksum:string;next_cursor:string|null}>(
      `SELECT chunk_index,checksum,next_cursor FROM article_format_network_chunks WHERE ${whereSession} AND dataset=? ORDER BY chunk_index`,[...this.values(m.syncId),dataset]);
    for(const row of rows){
      // The entire dataset's real chunk hashes matched the manifest before any ACK.
      const pageId=`${m.syncId}:${dataset}:${row.chunk_index}`;
      const receipt=await this.transport.request(m.articleFormats.ackUrl,{page_id:pageId,revision:m.syncVersion,next_cursor:row.next_cursor});
      requireFormat(receipt?.acknowledged===true&&receipt.page_id===pageId
        &&receipt.revision===m.syncVersion&&receipt.next_cursor===row.next_cursor,'POS_FORMAT_ACK_INVALID');
      await this.sql.executeAtomic([{statement:`UPDATE article_format_network_chunks SET ack_receipt=?
        WHERE ${whereSession} AND dataset=? AND chunk_index=? AND checksum=?`,
        values:[canonicalContent(receipt),...this.values(m.syncId),dataset,row.chunk_index,row.checksum]}]);
    }
  }
  async complete(syncId:string):Promise<NetworkMasterRevision>{
    const session=await this.session(syncId),m=JSON.parse(session.manifest) as Manifest;
    for(const dataset of NETWORK_MASTER_DATASETS)await this.verifyDataset(m,dataset,true);
    // Persist local completion before contacting ERP. A crash can resume without exposing staged data.
    await this.sql.executeAtomic([{statement:`UPDATE article_format_network_sessions SET state='LOCAL_READY' WHERE ${whereSession} AND state='STAGING'`,values:this.values(syncId)}]);
    const receipt=await this.transport.request(m.articleFormats.completeUrl,{revision:m.syncVersion,revision_checksum:m.articleFormats.revision_checksum});
    requireFormat(receipt?.complete===true&&receipt.revision===m.syncVersion&&receipt.revision_checksum===m.articleFormats.revision_checksum,'POS_FORMAT_COMPLETE_INVALID');
    await this.sql.executeAtomic([
      {statement:`UPDATE article_format_network_sessions SET state='COMPLETE',completion_receipt=? WHERE ${whereSession}`,values:[canonicalContent(receipt),...this.values(syncId)]},
      insert('article_format_network_active',`${sessionColumns},revision`,[...this.values(syncId),m.syncVersion]),
      {statement:`UPDATE article_format_network_active SET sync_id=?,revision=? WHERE ${whereScope} AND (revision<? OR sync_id=?)`,
        values:[syncId,m.syncVersion,...this.scope(),m.syncVersion,syncId]}
    ]);
    return this.revision(await this.session(syncId));
  }
  download(syncId?:string):Promise<NetworkMasterRevision>{
    if(this.inFlight){requireFormat(syncId===undefined||syncId===this.inFlightSyncId,'POS_FORMAT_SESSION_CONFLICT');return this.inFlight;}
    this.inFlightSyncId=syncId;
    this.inFlight=this.downloadRevision(syncId).finally(()=>{this.inFlight=undefined;this.inFlightSyncId=undefined;});return this.inFlight;
  }
  private async downloadRevision(syncId?:string):Promise<NetworkMasterRevision>{
    await this.migrate();
    if(!syncId){const staging=await this.getStagingRevision();syncId=staging?.syncId;}
    if(!syncId){const response=await this.transport.request(this.context.master_sessions_url,{});
      requireFormat(response?.schemaVersion===3&&response.contractVersion===3,'POS_FORMAT_SESSION_INVALID');uuid(response.syncId);syncId=response.syncId;}
    const manifest=await this.transport.request(`${this.path(syncId)}/manifest`);
    requireFormat(manifest?.syncId===syncId,'POS_FORMAT_SESSION_INVALID');await this.stageManifest(manifest);
    const m=manifest as Manifest;
    for(const dataset of NETWORK_MASTER_DATASETS){
      let cursor:string|null=null;
      for(let index=0;index<m.datasets[dataset].chunks;index++){
        const raw=await this.transport.request(`${this.path(syncId)}/datasets/${dataset}/chunks/${index}`);
        cursor=await this.stageChunk(m,dataset,index,raw,cursor);
      }
      // Zero chunks still produce an explicit verified empty dataset in this session.
      await this.verifyDataset(m,dataset);
      await this.acknowledgeDataset(m,dataset);
    }
    return this.complete(syncId);
  }
}
