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

/** CAS-only append operations. Ordinary ACK publication cannot write these protected fields. */
export async function validateV3FiscalMetadataMutation(mutation: DurableDocumentMutation): Promise<void> {
  if (!['transactions','transactionHistory'].includes(mutation.collectionName) || !mutation.expectedDocument
    || !mutation.v3CurrentCatalog || !mutation.document.v3InventoryBaseline || mutation.requireAbsent) denied();
  const previous = JSON.parse(mutation.expectedDocument!) as Transaction & Record<string,any>;
  const next = mutation.document as Transaction & Record<string,any>;
  if (previous.id !== next.id || previous.v3Binding !== mutation.v3CurrentCatalog!.binding) denied();
  const operation = mutation.v3FiscalMetadataOperation;
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
