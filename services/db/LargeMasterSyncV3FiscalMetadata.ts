import {validatePreparedAppliedReceipt,assertFiscalOriginalMirror} from '../fiscal/FiscalAppliedReceiptV2';
import {resolveFiscalPrintDisplay} from '../fiscal/FiscalPrintEvidence';
import { fiscalStatusSourceChecksum, validFiscalScope, verifyFiscalStatusProof } from '../fiscal/FiscalStatusProof';
import { sha256Utf8 } from '../sync/LargeMasterSyncV3Client';
import type { DurableDocumentMutation } from './DatabaseAdapter';
import type { Transaction } from '../../types';
import { canProjectFiscalClassification, applyFiscalClassificationProjection, fiscalClassificationChecksum,
  MSELLER_UNSUPPORTED_VAT_ERROR } from '../../utils/fiscalClassificationProjection';

const denied = (): never => { throw new Error('SYNC_V3_FISCAL_METADATA_MUTATION_DENIED'); };
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;
const equal = (a: any,b: any): boolean => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const without = (row: any, fields: string[]): any => Object.fromEntries(Object.entries(row).filter(([key])=>!fields.includes(key)));

/** Complete dispatch unit only: an append-only claim plus original active/history/config CAS. */
export async function validateFiscalDispatchClaimBatch(rows:DurableDocumentMutation[]):Promise<void>{
  const find=(name:string)=>rows.filter(row=>row.collectionName===name);
  if(rows.length!==4||rows.some(row=>row.v3FiscalMetadataOperation!=='FISCAL_DISPATCH_CLAIM')
    ||['fiscalDispatchClaims','transactions','transactionHistory','config'].some(name=>find(name).length!==1))denied();
  const claim=find('fiscalDispatchClaims')[0],source=find('transactions')[0],history=find('transactionHistory')[0],config=find('config')[0];
  const c=claim.document,scope=source.document.fiscalSubmissionScope;
  if(!claim.requireAbsent||claim.expectedDocument!==undefined||config.document.id!=='current'||!config.expectedDocument
    ||config.requireAbsent||JSON.stringify(config.document)!==config.expectedDocument||!scope
    ||c.id!==source.document.id||history.document.id!==c.id||c.sourceTransactionId!==c.id||c.providerId!=='MSELLER'
    ||c.schemaVersion!==2||c.state!=='DISPATCH_INTENT'||c.sourceChecksum!==scope.sourceChecksum
    ||!equal(c.submissionScope,scope)||!equal(history.document.fiscalSubmissionScope,scope)
    ||!Number.isFinite(Date.parse(c.claimedAt))||! /^[a-f0-9]{64}$/.test(c.requestSha256)
    ||Object.keys(c).sort().join(',')!==['id','schemaVersion','state','sourceTransactionId','providerId','scope','submissionScope','sourceChecksum','requestSha256','claimedAt','appliedReceipt','appliedReceiptExpectation','outboxAnchors'].sort().join(','))denied();
  if(!c.scope||Object.keys(c.scope).sort().join(',')!==['origin','tenantId','companyId','storeId','terminalId','deviceId'].sort().join(',')
    ||['tenantId','companyId','storeId','terminalId','deviceId'].some(key=>c.scope[key]!==scope[key]))denied();
  let origin:URL;try{origin=new URL(c.scope.origin);}catch{denied();}if(origin!.origin!==c.scope.origin)denied();
  {
    const prepared=await validatePreparedAppliedReceipt({receipt:c.appliedReceipt,expectation:c.appliedReceiptExpectation,anchors:c.outboxAnchors,
      originalTransaction:JSON.parse(c.outboxAnchors?.sale?.payload_json||'{}').transaction},c.scope,JSON.parse(source.expectedDocument||'{}'));
    assertFiscalOriginalMirror(JSON.parse(history.expectedDocument||'{}'),prepared.originalTransaction);
    if(c.sourceChecksum!==prepared.receipt.sourceDocument.checksum||scope.environment!==prepared.receipt.historicalEnvironment)denied();
  }
  for(const row of [source,history]){
    if(!row.expectedDocument||row.requireAbsent||row.document.zReportId)denied();
    const previous=JSON.parse(row.expectedDocument!);
    if(previous.zReportId||previous.fiscalProvider!=='MSELLER'||previous.fiscalProviderStatus==='V3_ISSUE_REQUESTED'
      ||previous.fiscalClassificationAttemptedAt||previous.fiscalReferenceId||previous.fiscalCertifiedNcf
      ||row.document.fiscalProviderStatus!=='V3_ISSUE_REQUESTED')denied();
    await validateV3FiscalMetadataMutation({...row,collectionName:'transactions',v3FiscalMetadataOperation:'FISCAL_SUBMISSION_SCOPE_APPEND',
      document:{...row.document,fiscalProviderStatus:previous.fiscalProviderStatus}});
  }
}

/** CAS-only append operations. Ordinary ACK publication cannot write these protected fields. */
export async function validateV3FiscalMetadataMutation(mutation: DurableDocumentMutation): Promise<void> {
  if (!['transactions','transactionHistory'].includes(mutation.collectionName) || !mutation.expectedDocument
    || !mutation.v3CurrentCatalog || !mutation.document.v3InventoryBaseline || mutation.requireAbsent) denied();
  const previous = JSON.parse(mutation.expectedDocument!) as Transaction & Record<string,any>;
  const next = mutation.document as Transaction & Record<string,any>;
  if (previous.id !== next.id || previous.v3Binding !== mutation.v3CurrentCatalog!.binding) denied();
  const operation = mutation.v3FiscalMetadataOperation;
  if (operation === 'FISCAL_SUBMISSION_SCOPE_APPEND' || operation === 'FISCAL_LOOKUP_APPROVAL_APPEND') {
    const field = operation === 'FISCAL_SUBMISSION_SCOPE_APPEND' ? 'fiscalSubmissionScope' : 'fiscalLookupApproval';
    const scope = next[field];
    if (operation === 'FISCAL_SUBMISSION_SCOPE_APPEND' && (previous.fiscalClassificationAttemptedAt || previous.fiscalLookupApproval
      || previous.fiscalReferenceId || previous.fiscalCertifiedNcf || previous.fiscalSyncError)) denied();
    if (operation === 'FISCAL_LOOKUP_APPROVAL_APPEND' && !(previous.fiscalProviderStatus==='V3_ISSUE_REQUESTED'
      || previous.fiscalClassificationAttemptedAt || previous.fiscalReferenceId || previous.fiscalCertifiedNcf)) denied();
    if (mutation.collectionName !== 'transactions' || previous[field] || !scope || !validFiscalScope(scope,previous)
      || scope.basis !== (operation === 'FISCAL_SUBMISSION_SCOPE_APPEND' ? 'PERSISTED_SUBMISSION_INTENT' : 'EXPLICIT_AUTHORIZED_LOOKUP')
      || scope.sourceChecksum !== await fiscalStatusSourceChecksum(previous) || previous.fiscalSyncStatus === 'SYNCED'
      || !equal(without(previous,[field]),without(next,[field]))) denied();
    return;
  }
  if (operation === 'FISCAL_PRINT_EVIDENCE_APPEND') {
    const canonicalSource=mutation.collectionName==='transactionHistory'
      ? JSON.parse(mutation.v3ExpectedRetainedDocument?.expected || '{}') : previous;
    const allowed=['fiscalPrintProof','fiscalPrintScope','fiscalQrUrl','fiscalSecurityCode','fiscalSignedAt'];
    const display=await resolveFiscalPrintDisplay({...previous,fiscalSubmissionScope:canonicalSource.fiscalSubmissionScope,fiscalLookupApproval:canonicalSource.fiscalLookupApproval,fiscalPrintProof:next.fiscalPrintProof,fiscalPrintScope:next.fiscalPrintScope});
    if (!display || !equal(next.fiscalPrintScope,canonicalSource.fiscalPrintScope||canonicalSource.fiscalSubmissionScope||canonicalSource.fiscalLookupApproval) || !equal(without(previous,allowed),without(next,allowed))
      || next.fiscalQrUrl!==display.qrUrl||next.fiscalSecurityCode!==display.securityCode||next.fiscalSignedAt!==display.signedAt) denied();
    return;
  }
  if (operation === 'FISCAL_STATUS_RECONCILE') {
    const canonicalSource = mutation.collectionName === 'transactionHistory'
      ? JSON.parse(mutation.v3ExpectedRetainedDocument?.expected || '{}') : previous;
    const scope = canonicalSource.fiscalSubmissionScope || canonicalSource.fiscalLookupApproval;
    const allowed = ['fiscalSyncStatus','fiscalSyncError','fiscalProviderStatus','fiscalReferenceId','fiscalCertifiedNcf',
      'fiscalResponseMessage','fiscalSyncedAt','fiscalStatusProof'];
    if (previous.fiscalSyncStatus === 'SYNCED' || !scope || next.fiscalSyncStatus !== 'SYNCED' || next.fiscalSyncError !== undefined
      || next.fiscalReferenceId !== next.fiscalStatusProof?.providerReceipt.internalTrackId
      || next.fiscalCertifiedNcf !== next.fiscalStatusProof?.providerReceipt.returnedNcf
      || next.fiscalProviderStatus !== next.fiscalStatusProof?.providerReceipt.status
      || next.fiscalSyncedAt !== next.fiscalStatusProof?.observedAt || !equal(without(previous,allowed),without(next,allowed))
      || !await verifyFiscalStatusProof(next.fiscalStatusProof,scope,previous)) denied();
    return;
  }
  if (operation === 'CLASSIFICATION_PROJECTION_APPEND') {
    if (previous.fiscalClassificationProjection || !canProjectFiscalClassification(previous)
      || !next.fiscalClassificationProjection || !equal(without(previous,['fiscalClassificationProjection']),without(next,['fiscalClassificationProjection']))) denied();
    await applyFiscalClassificationProjection(next);
    return;
  }
  if (operation === 'CLASSIFICATION_ATTEMPT_CONSUME') {
    if (!previous.fiscalClassificationProjection || !canProjectFiscalClassification(previous)
      || typeof next.fiscalClassificationAttemptedAt !== 'string' || !Number.isFinite(Date.parse(next.fiscalClassificationAttemptedAt))
      || !equal(without(previous,['fiscalClassificationAttemptedAt']),without(next,['fiscalClassificationAttemptedAt']))) denied();
    await applyFiscalClassificationProjection(next);
    return;
  }
  if (operation === 'PRESUBMIT_EVIDENCE_REPAIR') {
    const audit = next.fiscalPreSubmitRecoveryAudit, oldAudit = previous.fiscalPreSubmitRecoveryAudit || [];
    const entry = audit?.[audit.length-1];
    if (previous.fiscalProvider !== 'MSELLER' || !['E31','E32'].includes(String(previous.ncfType))
      || !previous.ncf || previous.ncf !== previous.electronicNcf || !previous.ncf.startsWith(String(previous.ncfType))
      || previous.fiscalSyncStatus !== 'ERROR' || previous.fiscalProviderStatus !== 'V3_ISSUE_REQUESTED'
      || previous.fiscalSyncError !== 'SYNC_V3_FISCAL_RECONCILIATION_REQUIRED'
      || previous.fiscalResponseMessage !== 'Existe un intento fiscal sin referencia confirmada. Requiere reconciliación antes de emitir de nuevo.'
      || previous.fiscalClassificationProjection || previous.fiscalClassificationAttemptedAt
      || ['fiscalReferenceId','fiscalCertifiedNcf','fiscalSyncedAt','fiscalQrUrl','fiscalSecurityCode','fiscalResponseCode','fiscalSignedXml','fiscalQrCode']
        .some(key => String(previous[key] ?? '').trim())
      || next.fiscalSyncError !== MSELLER_UNSUPPORTED_VAT_ERROR || next.fiscalResponseMessage !== MSELLER_UNSUPPORTED_VAT_ERROR
      || !Array.isArray(audit) || audit.length !== oldAudit.length+1 || !equal(audit.slice(0,-1),oldAudit)
      || !entry?.actorId || !entry.reason || entry.binding !== previous.v3Binding || entry.documentId !== previous.id || entry.ncf !== previous.ncf
      || entry.financialChecksum !== await fiscalClassificationChecksum(previous)
      || entry.archiveFullOriginalChecksumAvailable !== false || !entry.guardProof?.independentlyReviewedNoInterveningIssue
      || entry.guardProof?.observedOnlyBlockedRetry !== true || entry.guardProof?.installedVersion !== '1.1.513'
      || !/^[a-f0-9]{40}$/.test(entry.guardProof?.sourceCommit || '')
      || [entry.archiveFinancialSha256,entry.archiveProviderSha256,entry.guardProof?.apkSha256,entry.guardProof?.evidenceSha256,
        entry.guardProof?.blockedRetryRouteSha256].some(value => !/^[a-f0-9]{64}$/.test(value || ''))
      || !equal(entry.before,{error:previous.fiscalSyncError,response:previous.fiscalResponseMessage})
      || !equal(entry.after,{error:MSELLER_UNSUPPORTED_VAT_ERROR,response:MSELLER_UNSUPPORTED_VAT_ERROR})
      || (mutation.collectionName === 'transactions' ? entry.transactionChecksum : entry.historyChecksum) !== await sha256Utf8(mutation.expectedDocument!)
      || entry.scope?.binding !== previous.v3Binding || entry.scope?.terminalId !== previous.terminalId || !entry.scope?.companyId || !entry.scope?.tenantId
      || !equal(without(previous,['fiscalSyncError','fiscalResponseMessage','fiscalPreSubmitRecoveryAudit']),without(next,['fiscalSyncError','fiscalResponseMessage','fiscalPreSubmitRecoveryAudit']))) denied();
    return;
  }
  denied();
}
