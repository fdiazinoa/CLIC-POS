import type {BusinessConfig,Transaction} from '../../types';
import type {V3FinancialOptions} from '../sync/LargeMasterSyncV3FinancialCommit';
import {createAppliedReceiptReadiness,canonicalFiscalJson,validatePreparedAppliedReceipt,assertFiscalOriginalMirror,type FiscalOutboxAnchor,type PreparedAppliedReceipt} from './FiscalAppliedReceiptV2';
import {createMSellerDispatcher,FISCAL_DISPATCH_CLAIMS,type FiscalDispatchDependencies} from './FiscalMSellerDispatch';
import type {PreparationPolicy} from './Caja6FiscalPreparationPolicy';
export type PreparationStatus={state:'EMPTY'|'ARMING'|'ARMED'|'CAPTURING'|'SELECTED'|'PREPARING'|'PREPARED'|'HOLD';summary?:{ticket:string;ncf:string;date:string;amount:number;lines:number};message:string};
type Result={transaction:Transaction;created:boolean};
export interface PreparationPorts extends Omit<FiscalDispatchDependencies,'assertReady'> {
 commitTransaction:(transaction:Transaction,config:BusinessConfig,warehouseId:string,options?:V3FinancialOptions)=>Promise<Result>;
 fence:()=>Promise<number>;
 sourceSequences:(id:string)=>Promise<Array<{event_id:string;local_sequence:number}>>;
}
export interface FiscalPreparationController {status:()=>PreparationStatus;subscribe:(listener:()=>void)=>()=>void;arm:()=>Promise<void>;prepare:()=>Promise<void>;cancel:()=>void;commit:PreparationPorts['commitTransaction']}
type Captured={context:ReturnType<PreparationPorts['context']>;configRaw:string;binding:string;fence:number;epoch:number};
type Selection={cap:object;captured:Captured;transaction:Transaction;anchorsRaw:string;preparedRaw?:string};
const held=()=>Error('FISCAL_SINGLE_PREPARATION_HELD');
const substantivePin=(value:PreparedAppliedReceipt)=>{const {observedAt:_observedAt,...receipt}=value.receipt;return JSON.stringify(canonicalFiscalJson({...value,receipt}));};
/** DI validation alone may receive this opaque, one-selection command; native composition never supplies this port. */
export type SyntheticFutureCommandSink=(command:()=>Promise<unknown>)=>void;
export function createSingleFiscalPreparation(ports:PreparationPorts,policy:PreparationPolicy,syntheticFutureCommandSink?:SyntheticFutureCommandSink):FiscalPreparationController {
 let state:PreparationStatus={state:'EMPTY',message:'Preparación manual de una próxima venta nueva. No permite emitir.'},epoch=0,armed:Captured|undefined,selection:Selection|undefined,inflight:Promise<void>|undefined;
 const listeners=new Set<()=>void>(),publish=(next:PreparationStatus)=>{state=next;for(const notify of listeners){try{notify();}catch{/* An observer cannot change the financial commit outcome. */}}};
 const phase=()=>state.state;
 const hold=()=>{epoch++;armed=undefined;selection=undefined;publish({state:'HOLD',message:'Preparación retenida. No se ha autorizado ningún envío.'});};
 const current=(cap:object)=>{if(!selection||selection.cap!==cap||selection.captured.epoch!==epoch||state.state==='HOLD')throw held();return selection;};
 const capture=async()=>{const context=ports.context(),[config,catalog,fence]=await Promise.all([ports.get('config','current'),ports.catalog(),ports.fence()]);await policy.live(context,config,catalog.binding);context.assertCurrent();return{context,configRaw:JSON.stringify(config),binding:catalog.binding,fence,epoch};};
 const validate=async(cap:object)=>{
  const selected=current(cap),fresh=ports.context();if(fresh.fingerprint!==selected.captured.context.fingerprint)throw held();
  const [config,catalog,active,history,rows,claim]=await Promise.all([ports.get('config','current'),ports.catalog(),ports.get('transactions',selected.transaction.id),ports.get('transactionHistory',selected.transaction.id),ports.outboxRows(selected.transaction.id),ports.get(FISCAL_DISPATCH_CLAIMS,selected.transaction.id)]);
  current(cap);if(claim||!active||!history||catalog.binding!==selected.captured.binding||JSON.stringify(config)!==selected.captured.configRaw||JSON.stringify(rows)!==selected.anchorsRaw)throw held();
  assertFiscalOriginalMirror(active,selected.transaction);assertFiscalOriginalMirror(history,selected.transaction);await policy.source(fresh,config,catalog.binding,active,history,rows);fresh.assertCurrent();current(cap);return{active,history,config};
 };
 const readiness=(cap:object)=>createAppliedReceiptReadiness({pair:async id=>({transaction:await ports.get('transactions',id),history:await ports.get('transactionHistory',id)}),rows:ports.outboxRows,context:ports.context,catalog:ports.catalog,fetchImpl:async(input,init)=>{await validate(cap);current(cap);const response=await ports.fetchImpl(input,init);await validate(cap);return response;},timeoutMs:ports.timeoutMs});
 const prepareReadiness=async(cap:object):Promise<PreparedAppliedReceipt>=>{const before=await validate(cap),prepared=await readiness(cap)(before.active);await validate(cap);return prepared;};
 const exposeSyntheticCommand=(cap:object)=>{if(!syntheticFutureCommandSink)return;const authorization=Object.freeze({}),grants=new WeakSet<object>(),selected=current(cap);grants.add(authorization);
  syntheticFutureCommandSink(async()=>{if(!grants.has(authorization)||state.state!=='PREPARED'||current(cap)!==selected)throw held();grants.delete(authorization);
   try{const {active,config}=await validate(cap),snapshot=active.fiscalIssuance!;
   const dispatch=createMSellerDispatcher({...ports,assertReady:async mirror=>{const pin=current(cap).preparedRaw;if(!pin)throw held();const observation=await prepareReadiness(cap);if(substantivePin(observation)!==substantivePin(JSON.parse(pin)))throw Error('FISCAL_PREPARED_SELECTION_CHANGED');return validatePreparedAppliedReceipt(JSON.parse(pin),ports.context().descriptor,mirror);},fetchImpl:async(url,init)=>{current(cap);selected.captured.context.assertCurrent();return ports.fetchImpl(url,init);}});
   return await dispatch({providerId:'MSELLER',environment:0,transaction:active,credentialKey:snapshot.issuerRnc!,sequenceExpiryDate:snapshot.expiryDate,companyInfo:config.companyInfo});}catch(error){hold();throw error;}
  });
 };
 return {status:()=>({...state,...(state.summary?{summary:{...state.summary}}:{})}),subscribe:listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};},cancel:()=>{if(state.state!=='EMPTY')hold();},
 arm:async()=>{if(state.state!=='EMPTY')throw held();publish({state:'ARMING',message:'Verificando el alcance de esta caja…'});const mine=epoch;try{const captured=await capture();if(epoch!==mine||phase()!=='ARMING')throw held();armed=captured;publish({state:'ARMED',message:'Se observará únicamente la próxima venta nueva confirmada normalmente. No se enviará a e-factura.'});}catch(error){hold();throw error;}},
 commit:(transaction,config,warehouse,options)=>{
  if(state.state!=='ARMED')return ports.commitTransaction(transaction,config,warehouse,options);
  const intent=armed;armed=undefined;publish({state:'CAPTURING',message:'Esperando el commit local de la operación nueva…'});
  return (async()=>{let result:Result;try{result=await ports.commitTransaction(transaction,config,warehouse,options);}catch(error){hold();throw error;}
   try{if(!intent||intent.epoch!==epoch||!result.created||state.state!=='CAPTURING')throw held();const [rows,sequences]=await Promise.all([ports.outboxRows(result.transaction.id),ports.sourceSequences(result.transaction.id)]);
    if(!rows.length||sequences.length!==rows.length||rows.some(row=>!sequences.some(item=>item.event_id===row.event_id&&item.local_sequence>intent.fence)))throw held();
    const cap=Object.freeze({});selection={cap,captured:intent,transaction:JSON.parse(JSON.stringify(result.transaction)),anchorsRaw:JSON.stringify(rows)};await validate(cap);current(cap);const tx=result.transaction;
    publish({state:'SELECTED',summary:{ticket:tx.displayId||'Venta nueva',ncf:tx.ncf!,date:tx.date,amount:tx.total,lines:tx.items.length},message:'Operación nueva seleccionada. Preparar sólo consultará su materialización en ERP.'});
   }catch{hold();}return result;})();
 },
 prepare:()=>{if(state.state==='PREPARING'&&inflight)return inflight;if(state.state!=='SELECTED'||!selection)return Promise.reject(held());const cap=selection.cap;publish({...state,state:'PREPARING',message:'Consultando la preparación del original en ERP…'});
  inflight=(async()=>{try{const prepared=await prepareReadiness(cap);current(cap).preparedRaw=JSON.stringify(prepared);publish({...state,state:'PREPARED',message:'Materialización verificada. Emisión y aceptación DGII siguen retenidas.'});exposeSyntheticCommand(cap);}catch(error){hold();throw error;}})();return inflight;},
 };
}
