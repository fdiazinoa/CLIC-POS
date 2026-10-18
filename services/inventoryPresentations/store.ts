import {canonicalPresentationJson,inventoryPresentationRevision,validateInventoryPresentationMaster,type InventoryPresentationMaster} from './contract';
import {validatePresentationPage,type PresentationContext,type PresentationPage} from './client';
export interface PresentationSQLCore {
 executeSchema(sql:string):Promise<void>;
 query<T>(sql:string,values:(string|number|null)[]):Promise<T[]>;
 executeAtomic(statements:{statement:string;values?:(string|number|null)[]}[]):Promise<void>;
}
export interface PresentationSQL extends PresentationSQLCore {runExclusive<T>(work:(sql:PresentationSQLCore)=>Promise<T>):Promise<T>;runTransaction<T>(work:(sql:PresentationSQLCore)=>Promise<T>):Promise<T>}
export const INVENTORY_PRESENTATIONS_SCHEMA=`
CREATE TABLE IF NOT EXISTS inventory_presentation_contexts(context_key TEXT PRIMARY KEY,content TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS inventory_presentation_masters(context_key TEXT NOT NULL,master_revision TEXT NOT NULL,item_id TEXT NOT NULL,content TEXT NOT NULL,PRIMARY KEY(context_key,master_revision));
CREATE TABLE IF NOT EXISTS inventory_presentation_sessions(id TEXT PRIMARY KEY,binding_key TEXT NOT NULL,context_key TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('STAGING','COMPLETE')));
CREATE TABLE IF NOT EXISTS inventory_presentation_pages(session_id TEXT NOT NULL,page_index INTEGER NOT NULL,content TEXT NOT NULL,PRIMARY KEY(session_id,page_index));
CREATE TABLE IF NOT EXISTS inventory_presentation_selection(session_id TEXT NOT NULL,item_id TEXT NOT NULL,master_revision TEXT NOT NULL,content TEXT NOT NULL,PRIMARY KEY(session_id,item_id));
CREATE TABLE IF NOT EXISTS inventory_presentation_availability(binding_key TEXT PRIMARY KEY,state TEXT NOT NULL CHECK(state IN ('READY','DENIED')),context_key TEXT);
CREATE TABLE IF NOT EXISTS inventory_presentation_active(binding_key TEXT PRIMARY KEY,session_id TEXT NOT NULL);
${['contexts','masters'].flatMap(table=>['UPDATE','DELETE'].map(action=>`CREATE TRIGGER IF NOT EXISTS inventory_presentation_${table}_${action.toLowerCase()} BEFORE ${action} ON inventory_presentation_${table} BEGIN SELECT RAISE(ABORT,'INVENTORY_PRESENTATION_RETAINED_IMMUTABLE'); END;`)).join('\n')}
CREATE TRIGGER IF NOT EXISTS inventory_presentation_context_insert BEFORE INSERT ON inventory_presentation_contexts WHEN EXISTS(SELECT 1 FROM inventory_presentation_contexts WHERE context_key=NEW.context_key AND content<>NEW.content) BEGIN SELECT RAISE(ABORT,'INVENTORY_PRESENTATION_RETAINED_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS inventory_presentation_master_insert BEFORE INSERT ON inventory_presentation_masters WHEN EXISTS(SELECT 1 FROM inventory_presentation_masters WHERE context_key=NEW.context_key AND master_revision=NEW.master_revision AND (content<>NEW.content OR item_id<>NEW.item_id)) BEGIN SELECT RAISE(ABORT,'INVENTORY_PRESENTATION_RETAINED_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS inventory_presentation_session_insert BEFORE INSERT ON inventory_presentation_sessions WHEN EXISTS(SELECT 1 FROM inventory_presentation_sessions WHERE id=NEW.id AND state='COMPLETE') BEGIN SELECT RAISE(ABORT,'INVENTORY_PRESENTATION_RETAINED_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS inventory_presentation_session_update BEFORE UPDATE ON inventory_presentation_sessions WHEN OLD.state='COMPLETE' BEGIN SELECT RAISE(ABORT,'INVENTORY_PRESENTATION_RETAINED_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS inventory_presentation_session_delete BEFORE DELETE ON inventory_presentation_sessions WHEN OLD.state='COMPLETE' BEGIN SELECT RAISE(ABORT,'INVENTORY_PRESENTATION_RETAINED_IMMUTABLE'); END;
${['pages','selection'].flatMap(table=>['INSERT','UPDATE','DELETE'].map(action=>`CREATE TRIGGER IF NOT EXISTS inventory_presentation_${table}_${action.toLowerCase()} BEFORE ${action} ON inventory_presentation_${table} WHEN EXISTS(SELECT 1 FROM inventory_presentation_sessions WHERE id=${action==='INSERT'?'NEW':'OLD'}.session_id AND state='COMPLETE') BEGIN SELECT RAISE(ABORT,'INVENTORY_PRESENTATION_RETAINED_IMMUTABLE'); END;`)).join('\n')}
`;
const need=(value:unknown,code='INVENTORY_PRESENTATION_CACHE_INVALID')=>{if(!value)throw Error(code);};
/** Local commercial cache only. Complete revisions are never replaced or deleted. */
export class InventoryPresentationStore {
 private migration:Promise<void>|undefined;
 constructor(private readonly sql:PresentationSQL){}
 migrate(){return this.migration||(this.migration=this.sql.executeSchema(INVENTORY_PRESENTATIONS_SCHEMA).catch(error=>{this.migration=undefined;throw error;}));}
 async begin(sessionId:string,bindingKey:string,origin:string,context:PresentationContext){
  const content=canonicalPresentationJson({origin,context}),contextKey=await inventoryPresentationRevision({origin,contextRevision:context.contextRevision});
  await this.sql.runExclusive(async tx=>{
   const old=await tx.query<{content:string}>('SELECT content FROM inventory_presentation_contexts WHERE context_key=?',[contextKey]);need(!old.length||old[0].content===content);
   await tx.executeAtomic([{statement:'INSERT OR IGNORE INTO inventory_presentation_contexts VALUES(?,?)',values:[contextKey,content]},{statement:'INSERT INTO inventory_presentation_sessions VALUES(?,?,?,?)',values:[sessionId,bindingKey,contextKey,'STAGING']}]);
  });return contextKey;
 }
 async stage(sessionId:string,index:number,page:PresentationPage){
  await this.sql.runExclusive(async tx=>{
   const rows=await tx.query<{state:string;context_key:string;content:string}>('SELECT s.state,s.context_key,c.content FROM inventory_presentation_sessions s JOIN inventory_presentation_contexts c USING(context_key) WHERE s.id=?',[sessionId]);need(rows.length===1&&rows[0].state==='STAGING');
   const {context}=JSON.parse(rows[0].content);need(context.contextRevision===page.contextRevision&&page.schemaVersion===1&&page.contract==='INVENTORY_PRESENTATIONS_V1'&&Array.isArray(page.items)&&page.items.length<=200&&page.checksum===await inventoryPresentationRevision(page.items));
   const statements=[{statement:'INSERT INTO inventory_presentation_pages VALUES(?,?,?)',values:[sessionId,index,canonicalPresentationJson(page)] as (string|number)[]}];
   for(const item of page.items){await validateInventoryPresentationMaster(item,{contextRevision:context.contextRevision});statements.push({statement:'INSERT INTO inventory_presentation_selection VALUES(?,?,?,?)',values:[sessionId,item.itemId,item.masterRevision,canonicalPresentationJson(item)]});}
   await tx.executeAtomic(statements);
  });
 }
 async publish(sessionId:string,assertCurrent:()=>void){
  await this.sql.runTransaction(async tx=>{
   assertCurrent();
   const sessions=await tx.query<{binding_key:string;context_key:string;state:string;content:string}>('SELECT s.binding_key,s.context_key,s.state,c.content FROM inventory_presentation_sessions s JOIN inventory_presentation_contexts c USING(context_key) WHERE s.id=?',[sessionId]);need(sessions.length===1&&sessions[0].state==='STAGING');
   const session=sessions[0],context=JSON.parse(session.content).context as PresentationContext;
   const summary=(await tx.query<{n:number;first:number;last:number}>('SELECT count(*) n,min(page_index) first,max(page_index) last FROM inventory_presentation_pages WHERE session_id=?',[sessionId]))[0];need(summary.n>0&&summary.n<=1000&&summary.first===0&&summary.last===summary.n-1);
   let after:string|null=null,delivered=0;
   for(let index=0;index<summary.n;index++){
    assertCurrent();
    const rows=await tx.query<{content:string}>('SELECT content FROM inventory_presentation_pages WHERE session_id=? AND page_index=? LIMIT 1',[sessionId,index]);need(rows.length===1);
    const page=await validatePresentationPage(JSON.parse(rows[0].content),context,after);need(index===summary.n-1?page.nextAfter===null:page.nextAfter!==null);
    delivered+=page.items.length;
    if(page.items.length){
     const selected=await tx.query<{item_id:string;master_revision:string;content:string}>(`SELECT item_id,master_revision,content FROM inventory_presentation_selection WHERE session_id=? AND item_id IN (${page.items.map(()=>'?').join(',')})`,[sessionId,...page.items.map(item=>item.itemId)]);
     need(selected.length===page.items.length&&page.items.every(item=>selected.some(row=>row.item_id===item.itemId&&row.master_revision===item.masterRevision&&row.content===canonicalPresentationJson(item))));
     const retained=await tx.query<{master_revision:string;content:string}>(`SELECT master_revision,content FROM inventory_presentation_masters WHERE context_key=? AND master_revision IN (${page.items.map(()=>'?').join(',')})`,[session.context_key,...page.items.map(item=>item.masterRevision)]);
     for(const old of retained)need(selected.find(item=>item.master_revision===old.master_revision)?.content===old.content);
    }
    after=page.nextAfter;
   }
   const count=(await tx.query<{n:number}>('SELECT count(*) n FROM inventory_presentation_selection WHERE session_id=?',[sessionId]))[0];need(count.n===delivered);assertCurrent();
   await tx.executeAtomic([
    {statement:"INSERT OR IGNORE INTO inventory_presentation_masters(context_key,master_revision,item_id,content) SELECT s.context_key,x.master_revision,x.item_id,x.content FROM inventory_presentation_selection x JOIN inventory_presentation_sessions s ON s.id=x.session_id WHERE s.id=? AND s.state='STAGING'",values:[sessionId]},
    {statement:"UPDATE inventory_presentation_sessions SET state='COMPLETE' WHERE id=? AND state='STAGING'",values:[sessionId]},
    {statement:"INSERT INTO inventory_presentation_availability VALUES(?,'READY',?) ON CONFLICT(binding_key) DO UPDATE SET state='READY',context_key=excluded.context_key",values:[session.binding_key,session.context_key]},
    {statement:'INSERT INTO inventory_presentation_active VALUES(?,?) ON CONFLICT(binding_key) DO UPDATE SET session_id=excluded.session_id',values:[session.binding_key,sessionId]},
   ]);assertCurrent();
  });
 }
 async discard(sessionId:string){
  await this.sql.runExclusive(async tx=>{
   const rows=await tx.query<{state:string}>('SELECT state FROM inventory_presentation_sessions WHERE id=?',[sessionId]);if(!rows.length||rows[0].state==='COMPLETE')return;
   await tx.executeAtomic([{statement:'DELETE FROM inventory_presentation_selection WHERE session_id=?',values:[sessionId]},{statement:'DELETE FROM inventory_presentation_pages WHERE session_id=?',values:[sessionId]},{statement:'DELETE FROM inventory_presentation_sessions WHERE id=?',values:[sessionId]}]);
  });
 }
 async deny(bindingKey:string){
  await this.migrate();await this.sql.runExclusive(tx=>tx.executeAtomic([{statement:"INSERT INTO inventory_presentation_availability VALUES(?,'DENIED',NULL) ON CONFLICT(binding_key) DO UPDATE SET state='DENIED',context_key=NULL",values:[bindingKey]}]));
 }
 async active(bindingKey:string):Promise<{sessionId:string;contextKey:string;origin:string;context:PresentationContext}|null>{
  const rows=await this.sql.query<{session_id:string;context_key:string;content:string;state:string}>('SELECT a.session_id,s.context_key,c.content,s.state FROM inventory_presentation_active a JOIN inventory_presentation_sessions s ON s.id=a.session_id AND s.binding_key=a.binding_key JOIN inventory_presentation_contexts c USING(context_key) WHERE a.binding_key=?',[bindingKey]);
  if(!rows.length)return null;const availability=await this.sql.query<{state:string;context_key:string}>('SELECT state,context_key FROM inventory_presentation_availability WHERE binding_key=?',[bindingKey]);need(availability[0]?.state==='READY'&&availability[0]?.context_key===rows[0].context_key,'INVENTORY_PRESENTATION_ERP_DENIED');need(rows.length===1&&rows[0].state==='COMPLETE');const value=JSON.parse(rows[0].content);return {sessionId:rows[0].session_id,contextKey:rows[0].context_key,...value};
 }
 async masters(bindingKey:string,itemIds:string[]):Promise<Record<string,InventoryPresentationMaster>>{
  need(itemIds.length<=200,'INVENTORY_PRESENTATION_QUERY_LIMIT');if(!itemIds.length)return {};
  const rows=await this.sql.query<{item_id:string;content:string}>(`SELECT x.item_id,x.content FROM inventory_presentation_active a JOIN inventory_presentation_sessions s ON s.id=a.session_id AND s.binding_key=a.binding_key JOIN inventory_presentation_selection x ON x.session_id=s.id WHERE a.binding_key=? AND s.state='COMPLETE' AND x.item_id IN (${itemIds.map(()=>'?').join(',')})`,[bindingKey,...itemIds]);
  return Object.fromEntries(await Promise.all(rows.map(async row=>[row.item_id,await validateInventoryPresentationMaster(JSON.parse(row.content),{itemId:row.item_id})])));
 }
 async master(bindingKey:string,itemId:string):Promise<InventoryPresentationMaster|null>{return (await this.masters(bindingKey,[itemId]))[itemId]||null;}
 async retainedMany(contextKey:string,revisions:string[]):Promise<Record<string,InventoryPresentationMaster>>{
  need(revisions.length<=200,'INVENTORY_PRESENTATION_QUERY_LIMIT');if(!revisions.length)return {};
  const rows=await this.sql.query<{master_revision:string;content:string}>(`SELECT DISTINCT m.master_revision,m.content FROM inventory_presentation_masters m JOIN inventory_presentation_selection x ON x.master_revision=m.master_revision AND x.item_id=m.item_id AND x.content=m.content JOIN inventory_presentation_sessions s ON s.id=x.session_id AND s.context_key=m.context_key AND s.state='COMPLETE' WHERE m.context_key=? AND m.master_revision IN (${revisions.map(()=>'?').join(',')})`,[contextKey,...revisions]);
  return Object.fromEntries(await Promise.all(rows.map(async row=>[row.master_revision,await validateInventoryPresentationMaster(JSON.parse(row.content))])));
 }
 async retained(contextKey:string,revision:string):Promise<InventoryPresentationMaster|null>{
  const rows=await this.sql.query<{content:string}>('SELECT content FROM inventory_presentation_masters WHERE context_key=? AND master_revision=?',[contextKey,revision]);return rows.length?validateInventoryPresentationMaster(JSON.parse(rows[0].content)):null;
 }
}
