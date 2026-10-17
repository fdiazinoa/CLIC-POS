import type {BusinessConfig,Transaction} from '../../types';
import {explicitTerminalFiscalEnvironment} from '../../utils/terminalConfigSnapshot';
import {sha256Utf8} from '../sync/LargeMasterSyncV3Client';
import {validateFiscalOriginal,captureFiscalOutboxAnchors,assertFiscalOriginalMirror,type FiscalOutboxAnchor} from './FiscalAppliedReceiptV2';
import type {captureFiscalBoundContext} from './FiscalBoundContext';
export const CAJA6_FISCAL_SCOPE=Object.freeze({origin:'https://clic-erp-production.up.railway.app',tenantId:'9eda7d73-76e4-4432-ad13-4934fefe8f69',companyId:'6b6153ce-501e-4702-9ae9-34a3f1ab9042',storeId:'de8dd318-12e7-4a3f-b0e8-4ea1bdb70c07',terminalId:'351d5ae1-c8c9-4d09-a1fe-42096496778e',deviceSha256:'a1b588a89bd26bca0e43e81d0ca060cc0f1622f8f46d2a1901a1880273fdf9fe',issuerRnc:'130090752',fiscalRangeId:'1e778cf9-23c5-4530-b15a-b4182817bf48'});
type Context=ReturnType<typeof captureFiscalBoundContext>;
export type PreparationPolicy={live:(context:Context,config:BusinessConfig,binding:string)=>Promise<void>;source:(context:Context,config:BusinessConfig,binding:string,transaction:Transaction,history:Transaction,rows:FiscalOutboxAnchor[])=>Promise<void>};
const deny=():never=>{throw Error('FISCAL_SINGLE_PREPARATION_SCOPE_HELD');};
const object=(value:any):Record<string,any>=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const delegated=(terminal:any)=>{const snapshot=object(terminal.config?.erpSnapshot),resolved=object(snapshot.resolved),wrapper=object(resolved.terminalFiscalConfig||resolved.terminal_fiscal_config);const record=[wrapper,object(wrapper.fiscal),object(resolved.fiscal),object(object(snapshot.config).fiscal)].find(candidate=>['providerId','provider_id','provider'].some(key=>Object.prototype.hasOwnProperty.call(candidate,key))||candidate.enabled===false)||{};const keys=['deliveryMode','delivery_mode'].filter(key=>Object.prototype.hasOwnProperty.call(record,key));return keys.length>0&&keys.every(key=>record[key]==='DELEGATED_ERP')&&terminal.config?.fiscal?.deliveryMode==='DELEGATED_ERP';};
/** Dependencies are explicit synthetic test ports; native composition always uses these production defaults. */
export function createCaja6PreparationPolicy(testPorts?:{hashDevice?:(literal:string)=>Promise<string>;origin?:string}):PreparationPolicy {
 const hash=testPorts?.hashDevice||sha256Utf8,origin=testPorts?.origin||CAJA6_FISCAL_SCOPE.origin,allowed=CAJA6_FISCAL_SCOPE;
 const live=async(context:Context,config:BusinessConfig,binding:string)=>{
  context.assertCurrent();const scope=context.descriptor;
  if(scope.origin!==origin||(['tenantId','companyId','storeId','terminalId'] as const).some(key=>scope[key]!==allowed[key])||!scope.deviceId||await hash(scope.deviceId)!==allowed.deviceSha256)deny();
  const terminals=(config.terminals||[]).filter(row=>row.id===scope.terminalId);if(terminals.length!==1)deny();const terminal=terminals[0],erp=terminal.config?.erpBinding;
  if(terminal.config?.currentDeviceId!==scope.deviceId||erp?.tenantId!==scope.tenantId||erp?.companyId!==scope.companyId||erp?.storeId!==scope.storeId||String(config.companyInfo?.rnc||'').replace(/[\s.-]/g,'')!==allowed.issuerRnc||explicitTerminalFiscalEnvironment(terminal,scope.terminalId,'MSELLER','ECF')!==0||!delegated(terminal))deny();
  let retained:any;try{retained=JSON.parse(binding);}catch{deny();}
  if(!Array.isArray(retained)||retained.length!==5||JSON.stringify(retained)!==binding||retained[0]!==scope.tenantId||retained[1]!==scope.terminalId||retained[2]!==scope.deviceId||retained[3]!==context.base||new URL(retained[3]).origin!==scope.origin)deny();context.assertCurrent();
 };
 return {live,source:async(context,config,binding,transaction,history,rows)=>{
  await live(context,config,binding);const tx=transaction as Transaction&Record<string,any>,snapshot=tx.fiscalIssuance;
  if(tx.documentType!=='TICKET'||tx.ncfType!=='E32'||tx.fiscalProvider!=='MSELLER'||tx.fiscalMode!=='ECF'||!Object.prototype.hasOwnProperty.call(tx,'fiscalEnvironment')||tx.fiscalEnvironment!==0||tx.v3Binding!==binding||tx.total<=0
   ||[tx.originalTransactionId,tx.reservationId,tx.v3ReservationClaimId,tx.v3RestoredTicketId,tx.restaurantOrderId,tx.restaurantTableId,tx.zReportId,tx.closedAt,tx.closingId,tx.fiscalSubmissionScope,tx.fiscalLookupApproval,tx.fiscalStatusProof,tx.fiscalPrintProof,tx.fiscalClassificationAttemptedAt,tx.fiscalReferenceId,tx.fiscalCertifiedNcf].some(Boolean)||tx.fiscalProviderStatus==='V3_ISSUE_REQUESTED'
   ||!snapshot||snapshot.issuerRnc!==allowed.issuerRnc||snapshot.fiscalRangeId!==allowed.fiscalRangeId||!snapshot.fiscalAllocationId||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(snapshot.fiscalAllocationId)||snapshot.allocationStart!==500||snapshot.allocationEnd!==1000||snapshot.sequence<500||snapshot.sequence>1000)deny();
  if([history.fiscalSubmissionScope,history.fiscalLookupApproval,history.fiscalStatusProof,history.fiscalPrintProof,history.fiscalClassificationAttemptedAt,history.fiscalReferenceId,history.fiscalCertifiedNcf].some(Boolean)||history.fiscalProviderStatus==='V3_ISSUE_REQUESTED')deny();
  assertFiscalOriginalMirror(history,tx);const {origin:_origin,...scope}=context.descriptor;const original=await validateFiscalOriginal(captureFiscalOutboxAnchors(rows,tx.id),scope);assertFiscalOriginalMirror(tx,original.transaction);assertFiscalOriginalMirror(history,original.transaction);context.assertCurrent();
 }};
}
