import {resolveFiscalPrintDisplay} from './FiscalPrintEvidence';
import type { Transaction } from '../../types';
import type { DurableDocumentMutation } from '../db/DatabaseAdapter';
import { fiscalStatusSourceChecksum,verifyFiscalStatusProof,type FiscalStatusScope,type FiscalStatusProof } from './FiscalStatusProof';

type Catalog = {syncId:string;syncVersion:number;binding:string};
export interface FiscalStatusContext {
  scope: Omit<FiscalStatusScope,'basis'|'sourceChecksum'|'capturedAt'|'approvedById'>;
  catalog: Catalog; assertCurrent: ()=>Promise<void>;
}
export interface FiscalStatusDependencies {
  context: ()=>Promise<FiscalStatusContext>;
  pair: (id:string)=>Promise<{transaction:Transaction;history:Transaction}>;
  candidates: (binding:string,after:string,limit:number)=>Promise<string[]>;
  commit: (mutations:DurableDocumentMutation[])=>Promise<void>;
  get: (tx:Transaction,scope:FiscalStatusScope)=>Promise<FiscalStatusProof>;
  publish: (tx:Transaction)=>void;
  now?:()=>number;
}
const same=(a:any,b:any)=>JSON.stringify(a)===JSON.stringify(b);
const attempted=(tx:Transaction)=>tx.fiscalProvider==='MSELLER'&&Boolean(tx.fiscalProviderStatus==='V3_ISSUE_REQUESTED'
  ||tx.fiscalClassificationAttemptedAt||tx.fiscalReferenceId||tx.fiscalCertifiedNcf);
export class FiscalStatusReconciler {
  private generation=0;private inflight=new Map<string,Promise<string>>();private cooldown=new Map<string,number>();
  private tail:Promise<unknown>=Promise.resolve();private jobs:Promise<void>|undefined;private cursor='';
  constructor(private readonly deps:FiscalStatusDependencies){}
  dispose(){this.generation++;this.cursor='';this.cooldown.clear();}
  private serialize<T>(operation:()=>Promise<T>):Promise<T>{const task=this.tail.then(operation);this.tail=task.catch(()=>{});return task;}
  async consult(id:string,manual=false,actorId?:string,approvedLookupEnvironment?:number):Promise<string>{
    const context=await this.deps.context(),generation=this.generation,key=context.scope.binding+':'+id;
    const pending=this.inflight.get(key);if(pending)return pending;
    const now=(this.deps.now||Date.now)();
    if(!manual&&now-(this.cooldown.get(key)??-Infinity)<60000)return 'Consulta fiscal en espera.';
    const operation=this.serialize(async()=>{
      this.cooldown.set(key,(this.deps.now||Date.now)());await context.assertCurrent();
      if(generation!==this.generation)throw Error('FISCAL_STATUS_SCOPE_CHANGED');
      let pair=await this.deps.pair(id),tx=pair.transaction;
      if(tx.fiscalSyncStatus==='SYNCED'&&await resolveFiscalPrintDisplay(tx))return 'Estado fiscal confirmado.';
      if(!attempted(tx)||tx.terminalId!==context.scope.terminalId||(tx as any).v3Binding!==context.scope.binding)throw Error('FISCAL_STATUS_ATTEMPT_REQUIRED');
      const checksum=await fiscalStatusSourceChecksum(tx);
      let scope=tx.fiscalSubmissionScope||tx.fiscalLookupApproval;
      if(!scope){
        if(!manual||!actorId||approvedLookupEnvironment!==context.scope.environment)throw Error('FISCAL_STATUS_LOOKUP_APPROVAL_REQUIRED');
        scope={...context.scope,basis:'EXPLICIT_AUTHORIZED_LOOKUP',sourceChecksum:checksum,capturedAt:new Date().toISOString(),approvedById:actorId};
        await this.deps.commit([{collectionName:'transactions',document:{...tx,fiscalLookupApproval:scope},expectedDocument:JSON.stringify(tx),
          v3CurrentCatalog:context.catalog,v3FiscalMetadataOperation:'FISCAL_LOOKUP_APPROVAL_APPEND'}]);
        pair=await this.deps.pair(id);tx=pair.transaction;
      }
      if(scope.sourceChecksum!==checksum||Object.keys(context.scope).some(key=>(scope as any)[key]!==(context.scope as any)[key]))throw Error('FISCAL_STATUS_SCOPE_CHANGED');
      const proof=await this.deps.get(tx,scope);
      await context.assertCurrent();if(generation!==this.generation)throw Error('FISCAL_STATUS_SCOPE_CHANGED');
      const accepted=await verifyFiscalStatusProof(proof,scope,tx);
      const display=await resolveFiscalPrintDisplay({...tx,fiscalPrintProof:proof});
      if(!accepted&&!display)return 'Estado aún no confirmado; se conservó la evidencia fiscal.';
      const fresh=await this.deps.pair(id);
      if(fresh.transaction.fiscalSyncStatus==='SYNCED'&&!display)return 'Estado fiscal confirmado.';
      if(!same(fresh.transaction,tx)||!same(fresh.history,pair.history))throw Error('FISCAL_STATUS_SOURCE_CHANGED');
      const fields=fresh.transaction.fiscalSyncStatus==='SYNCED'||!accepted ? {} : {fiscalSyncStatus:'SYNCED' as const,fiscalSyncError:undefined,fiscalProviderStatus:proof.providerReceipt.status,
        fiscalReferenceId:proof.providerReceipt.internalTrackId,fiscalCertifiedNcf:proof.providerReceipt.returnedNcf,
        fiscalResponseMessage:'Estado fiscal aceptado confirmado con el proveedor.',fiscalSyncedAt:proof.observedAt,fiscalStatusProof:proof};
      const printOnly=fresh.transaction.fiscalSyncStatus==='SYNCED'||!accepted;
      const mutations=([['transactions',fresh.transaction],['transactionHistory',fresh.history]] as const).map(([collectionName,original])=>({
        collectionName,document:{...original,...fields},expectedDocument:JSON.stringify(original),v3CurrentCatalog:context.catalog,
        v3FiscalMetadataOperation:'FISCAL_STATUS_RECONCILE' as const,
        ...(collectionName==='transactionHistory'?{v3ExpectedRetainedDocument:{collection:'transactions',id:tx.id,expected:JSON.stringify(tx)}}:{})}));
      await context.assertCurrent();if(!printOnly)await this.deps.commit(mutations);
      if(display)await this.appendPrintEvidence(id,proof);
      await context.assertCurrent();
      if(generation===this.generation&&!display)this.deps.publish(mutations[0].document);
      return accepted ? 'Estado fiscal aceptado y actualizado.' : 'Evidencia de firma disponible; aceptación fiscal pendiente.';
    });
    this.inflight.set(key,operation);void operation.finally(()=>this.inflight.delete(key)).catch(()=>{});return operation;
  }
  async appendPrintEvidence(id:string,proof:FiscalStatusProof):Promise<void>{
    const context=await this.deps.context();await context.assertCurrent();
    const pair=await this.deps.pair(id);
    const display=await resolveFiscalPrintDisplay({...pair.transaction,fiscalPrintProof:proof});
    if(!display)return;
    const fields={fiscalPrintProof:proof,fiscalPrintScope:pair.transaction.fiscalPrintScope||pair.transaction.fiscalSubmissionScope||pair.transaction.fiscalLookupApproval,fiscalQrUrl:display.qrUrl,fiscalSecurityCode:display.securityCode,fiscalSignedAt:display.signedAt};
    const mutations=([['transactions',pair.transaction],['transactionHistory',pair.history]] as const).map(([collectionName,original])=>({
      collectionName,document:{...original,...fields},expectedDocument:JSON.stringify(original),v3CurrentCatalog:context.catalog,
      v3FiscalMetadataOperation:'FISCAL_PRINT_EVIDENCE_APPEND' as const,
      ...(collectionName==='transactionHistory'?{v3ExpectedRetainedDocument:{collection:'transactions',id,expected:JSON.stringify(pair.transaction)}}:{})}));
    await context.assertCurrent();await this.deps.commit(mutations);this.deps.publish(mutations[0].document);
  }
  runAutomatic():Promise<void>{
    if(this.jobs)return this.jobs;
    const generation=this.generation;
    const job=(async()=>{
      const context=await this.deps.context();await context.assertCurrent();
      let ids=await this.deps.candidates(context.scope.binding,this.cursor,10);
      if(!ids.length&&this.cursor){this.cursor='';ids=await this.deps.candidates(context.scope.binding,'',10);}
      for(const id of ids.slice(0,10)){
        if(generation!==this.generation)break;this.cursor=id;
        try{await this.consult(id);}catch{/* Held/offline requests never authorize issue or change evidence. */}
      }
    })();this.jobs=job;void job.finally(()=>{if(this.jobs===job)this.jobs=undefined;}).catch(()=>{});return job;
  }
}
