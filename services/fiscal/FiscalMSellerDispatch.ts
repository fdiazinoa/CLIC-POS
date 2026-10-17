import {validatePreparedAppliedReceipt,assertFiscalOriginalMirror,captureFiscalOutboxAnchors,type PreparedAppliedReceipt,type FiscalOutboxAnchor} from './FiscalAppliedReceiptV2';
import {getLargeMasterSyncV3OperationalSession} from '../sync/LargeMasterSyncV3OperationalSession';
import type {Transaction} from '../../types';
import type {IssueFiscalDocumentInput,FiscalIssueResponse} from './fiscalService';
import type {DurableDocumentMutation} from '../db/DatabaseAdapter';
import {db} from '../../utils/db';
import {dbAdapter} from '../db';
import {assertFiscalIssuance} from '../../utils/fiscalIssuance';
import {sha256Utf8} from '../sync/LargeMasterSyncV3Client';
import {resolveFiscalPrintDisplay} from './FiscalPrintEvidence';
import type {FiscalStatusProof} from './FiscalStatusProof';
import {fiscalStatusSourceChecksum} from './FiscalStatusProof';
import {captureFiscalBoundContext} from './FiscalBoundContext';
export const FISCAL_DISPATCH_CLAIMS='fiscalDispatchClaims';
export interface FiscalDispatchDependencies {
 /** Unwired production prerequisite: Receipt-aware prepared port; production remains disconnected and tests use exact synthetic ERP fixtures. */
 assertReady:(transaction:Transaction)=>Promise<PreparedAppliedReceipt>;
 context:()=>ReturnType<typeof captureFiscalBoundContext>;
 get:(collection:string,id:string)=>Promise<any>;
 commit:(mutations:DurableDocumentMutation[])=>Promise<void>;
 fetchImpl:typeof fetch;
 outboxRows:(transactionId:string)=>Promise<FiscalOutboxAnchor[]>;
 catalog:()=>Promise<{syncId:string;syncVersion:number;binding:string}>;
 timeoutMs?:number;
}
export const requireFiscalErpAppliedReceipt=async(_transaction:Transaction):Promise<PreparedAppliedReceipt>=>{throw Error('FISCAL_ERP_APPLIED_RECEIPT_REQUIRED');};
const unknown=()=>Error('FISCAL_DISPATCH_UNKNOWN_GET_ONLY');
export const createMSellerDispatcher=(deps:FiscalDispatchDependencies)=>(async(input:IssueFiscalDocumentInput):Promise<FiscalIssueResponse>=>{
 const mirror=input.transaction,claimId=String(mirror.id||'');if(!claimId)throw Error('FISCAL_SOURCE_REQUIRED');
 // Key is source ID alone: changing NCF/provider/scope never grants a second dispatch.
 if(await deps.get(FISCAL_DISPATCH_CLAIMS,claimId))throw unknown();
 if(mirror.fiscalProviderStatus==='V3_ISSUE_REQUESTED'||mirror.fiscalClassificationAttemptedAt||mirror.fiscalReferenceId||mirror.fiscalCertifiedNcf)throw unknown();
 const readiness=await deps.assertReady(mirror); // Production always HOLD before markers/claims/POST until operational connection is separately reviewed and authorized.
 const context=deps.context(),scope=context.descriptor;
 const prepared=await validatePreparedAppliedReceipt(readiness,scope,mirror),tx=prepared.originalTransaction;
 if(input.environment!==prepared.receipt.historicalEnvironment)throw Error('FISCAL_APPLIED_HISTORICAL_ENVIRONMENT_REQUIRED');
 if(input.providerId!=='MSELLER'||tx.fiscalProvider!=='MSELLER'||!['E31','E32','E34','E44','E45'].includes(String(tx.ncfType))||![0,1,2].includes(input.environment))throw Error('FISCAL_REQUEST_INVALID');
 if(tx.ncfType==='E34'&&tx.total<0)throw Error('FISCAL_SIGNED_TOTAL_CONTRACT_REQUIRED');
 assertFiscalIssuance(tx);const snapshot=tx.fiscalIssuance;
 if(!snapshot||snapshot.issuerRnc===null||snapshot.tenantId===null||snapshot.companyId===null||input.credentialKey!==snapshot.issuerRnc
   ||tx.ncf!==snapshot.ncf||tx.electronicNcf!==snapshot.ncf||snapshot.expiryDate!== (input.sequenceExpiryDate??null))throw Error('FISCAL_ORIGINAL_AUTHORITY_REQUIRED');
 if((['E31','E44','E45'].includes(tx.ncfType!)||tx.ncfType==='E32'&&Math.abs(tx.total)>=250000)&&!/^(?:\d{9}|\d{11})$/.test(String(tx.customerSnapshot?.taxId||(tx as any).taxId||'').replace(/[\s-]/g,'')))throw Error('FISCAL_BUYER_REQUIRED');
 if(snapshot.tenantId!==scope.tenantId||snapshot.companyId!==scope.companyId||snapshot.terminalId!==scope.terminalId||tx.terminalId!==scope.terminalId
   ||String(input.companyInfo.rnc).replace(/[\s-]/g,'')!==snapshot.issuerRnc)throw Error('FISCAL_SUBMISSION_SCOPE_CHANGED');
 const [source,history,config]=await Promise.all([deps.get('transactions',tx.id),deps.get('transactionHistory',tx.id),deps.get('config','current')]);
 if(!source||!history||source.zReportId||history.zReportId)throw Error('FISCAL_STATUS_ARCHIVED_RECONCILIATION_REQUIRED');
 if(!config)throw Error('FISCAL_SUBMISSION_SCOPE_CHANGED');
 if(JSON.stringify(source)!==JSON.stringify(mirror))throw Error('FISCAL_SUBMISSION_SOURCE_CHANGED');
 assertFiscalOriginalMirror(source,tx);assertFiscalOriginalMirror(history,tx);
 const body=JSON.stringify({providerId:'MSELLER',environment:input.environment,documentCode:tx.ncfType,companyInfo:input.companyInfo,transaction:tx,
  options:{appliedReceiptExpectation:prepared.expectation,fiscalIssuance:snapshot,fiscalRangeId:snapshot.fiscalRangeId,fiscalAllocationId:snapshot.fiscalAllocationId,sequenceExpiryDate:snapshot.expiryDate,
   credentialKey:input.credentialKey,deliveryMode:'DELEGATED_ERP',taxRate:input.taxRate,tipoIngreso:input.tipoIngreso,modificationCode:input.modificationCode,unitCodeGoods:input.unitCodeGoods,unitCodeServices:input.unitCodeServices,
   establishmentCode:input.establishmentCode,branchCode:input.branchCode,branchName:input.branchName,cashierCode:input.cashierCode}});
 const catalog=await deps.catalog();
 if(catalog.binding!==tx.v3Binding)throw Error('FISCAL_V3_BINDING_MISMATCH');
 const submissionScope={basis:'PERSISTED_SUBMISSION_INTENT' as const,providerId:'MSELLER' as const,environment:input.environment,issuerRnc:snapshot.issuerRnc,tenantId:scope.tenantId,companyId:scope.companyId,storeId:scope.storeId,terminalId:scope.terminalId,deviceId:scope.deviceId,binding:tx.v3Binding!,sourceChecksum:await fiscalStatusSourceChecksum(tx),capturedAt:new Date().toISOString()};
 const claim={id:claimId,schemaVersion:2,state:'DISPATCH_INTENT',sourceTransactionId:tx.id,providerId:'MSELLER',scope,submissionScope,appliedReceipt:prepared.receipt,appliedReceiptExpectation:prepared.expectation,outboxAnchors:prepared.anchors,sourceChecksum:await fiscalStatusSourceChecksum(tx),requestSha256:await sha256Utf8(body),claimedAt:new Date().toISOString()};
 context.assertCurrent();
 await deps.commit([{collectionName:FISCAL_DISPATCH_CLAIMS,document:claim,requireAbsent:true,v3FiscalMetadataOperation:'FISCAL_DISPATCH_CLAIM'},
  ...([['transactions',source],['transactionHistory',history]] as const).map(([collectionName,original])=>({collectionName,
   document:{...original,fiscalSubmissionScope:submissionScope,fiscalProviderStatus:'V3_ISSUE_REQUESTED'},expectedDocument:JSON.stringify(original),v3CurrentCatalog:catalog,
   v3FiscalMetadataOperation:'FISCAL_DISPATCH_CLAIM' as const})),
  {collectionName:'config',document:config,expectedDocument:JSON.stringify(config),v3FiscalMetadataOperation:'FISCAL_DISPATCH_CLAIM'}]);
 context.assertCurrent(); // Failure after claim is conservatively GET-only forever, even before fetch.
 if(JSON.stringify(await deps.get('config','current'))!==JSON.stringify(config))throw unknown();
 if((await deps.catalog()).binding!==tx.v3Binding)throw unknown();
 const currentAnchors=captureFiscalOutboxAnchors(await deps.outboxRows(tx.id),tx.id);
 if(JSON.stringify(currentAnchors)!==JSON.stringify(prepared.anchors))throw unknown();
 const committedSource=await deps.get('transactions',tx.id);
 if(JSON.stringify(committedSource)!==JSON.stringify({...source,fiscalSubmissionScope:submissionScope,fiscalProviderStatus:'V3_ISSUE_REQUESTED'}))throw unknown();
 context.assertCurrent();
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),deps.timeoutMs??5000);
 try{
  const response=await deps.fetchImpl(`${scope.origin}/api/fiscal/documents/issue`,{method:'POST',headers:{...context.headers,'Content-Type':'application/json',Accept:'application/json'},body,
   redirect:'error',credentials:'omit',cache:'no-store',signal:controller.signal});
  context.assertCurrent();const payload=await response.json();context.assertCurrent();
  if(!response.ok||!payload||payload.providerId!=='MSELLER'||payload.documentCode!==tx.ncfType||payload.environment!==input.environment||typeof payload.success!=='boolean')throw unknown();
  // Keep only the documented proof DTO; no raw response, message, credentials or arbitrary nested fields.
  const pick=(row:any,keys:string[])=>Object.fromEntries(keys.filter(key=>row?.[key]!==undefined).map(key=>[key,row[key]]));
  const raw=payload.printEvidenceProof;
  const proof=raw&&raw.source==='ERP_SCOPED_PROVIDER_ISSUE'&&raw.decision==='PENDING'?{
    ...pick(raw,['schemaVersion','source','environmentBasis','historicalEnvironment','decision','observedAt']),
    scope:pick(raw.scope,['tenantId','companyId','storeId','terminalId','deviceId']),
    document:pick(raw.document,['erpDocumentId','sourceTransactionId','ncf','ncfType','sourceChecksum','total']),
    issuer:pick(raw.issuer,['rnc','providerId','environment','credentialCompanyId','credentialAccountRnc']),
    lookup:pick(raw.lookup,['requestedNcf']),providerReceipt:{...pick(raw.providerReceipt,['returnedNcf','internalTrackId','status','success','pending','invoiceTotal']),
      printEvidence:pick(raw.providerReceipt?.printEvidence,['schemaVersion','qrUrl','securityCode','signedAt'])},
  } as unknown as FiscalStatusProof:undefined;
  const printEvidenceProof=proof&&await resolveFiscalPrintDisplay({...tx,fiscalSubmissionScope:submissionScope,fiscalPrintProof:proof})?proof:undefined;
  // ISSUE is never acceptance authority, even if a proxy/provider labels it successful/accepted.
  return {success:payload.success,providerId:'MSELLER',documentCode:tx.ncfType as FiscalIssueResponse['documentCode'],environment:input.environment,pending:true,
   status:'PENDING',message:'FISCAL_GET_CONFIRMATION_REQUIRED',
   ...(printEvidenceProof?{printEvidenceProof}:{})};
 }catch{throw unknown();}finally{clearTimeout(timeout);}
});
export const dispatchMSellerDocument=createMSellerDispatcher({outboxRows:async id=>{if(!dbAdapter.getFiscalAppliedSourceRows)throw Error('FISCAL_NATIVE_CAS_REQUIRED');return dbAdapter.getFiscalAppliedSourceRows(id);},assertReady:requireFiscalErpAppliedReceipt,context:captureFiscalBoundContext,
 catalog:async()=>{const session=await getLargeMasterSyncV3OperationalSession();await session.assertCurrent();return {...session.ready.runtime.version,binding:session.binding};},
 get:(collection,id)=>db.getDocument(collection as any,id),commit:async mutations=>{if(!dbAdapter.supportsV3FiscalMetadataCAS||!dbAdapter.saveDocumentsAtomically)throw Error('FISCAL_NATIVE_CAS_REQUIRED');await dbAdapter.saveDocumentsAtomically(mutations);},fetchImpl:(input,init)=>fetch(input,init)});
