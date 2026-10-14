/** Explicit incident repair preparation only. No automatic retry rule, transport, SQLite CLI or device IO. */
import type { Transaction } from '../../types';
import type { DatabaseAdapter, DurableDocumentMutation } from '../../services/db/DatabaseAdapter';
import { sha256Utf8 } from '../../services/sync/LargeMasterSyncV3Client';
import { MSELLER_UNSUPPORTED_VAT_ERROR, fiscalClassificationChecksum } from '../../utils/fiscalClassificationProjection';

type Document = Transaction & Record<string, any>;
type Scope = { tenantId: string; companyId: string; terminalId: string; binding: string };
export type FiscalEvidenceRepairInput = {
  current: Document; history: Document; currentCatalog: { syncId: string; syncVersion: number; binding: string };
  scope: Scope; target: Scope & { id: string; displayId: string; ncf: string };
  archives: { financialText: string; providerText: string; financialSha256: string; providerSha256: string };
  guardProof: { installedVersion: '1.1.513'; sourceCommit: string; apkSha256: string; evidenceSha256: string;
    blockedRetryRouteSha256: string; observedOnlyBlockedRetry: true; independentlyReviewedNoInterveningIssue: true };
  actorId: string; reason: string;
};
export type PreparedFiscalEvidenceRepair = {
  operationId: string; scope: Scope; mutations: DurableDocumentMutation[];
  summary: { documentId: string; ncf: string; financialChecksum: string; archiveFullOriginalChecksumAvailable: false;
    transactionChecksum: string; historyChecksum: string; archiveFinancialSha256: string; archiveProviderSha256: string };
};
const same = (a: unknown,b: unknown): boolean => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;
const require = (condition: unknown): void => { if (!condition) throw new Error('FISCAL_EVIDENCE_REPAIR_DENIED'); };
const digest = (value: string): boolean => /^[a-f0-9]{64}$/.test(value);

export async function prepareFiscalPresubmitEvidenceRepair(input: FiscalEvidenceRepairInput): Promise<PreparedFiscalEvidenceRepair> {
  const {current,history,scope,target,archives,guardProof}=input;
  require(input.currentCatalog.binding === scope.binding && Boolean(input.currentCatalog.syncId) && Number.isSafeInteger(input.currentCatalog.syncVersion));
  require(input.actorId.trim() && input.reason.trim() && same(scope,{tenantId:target.tenantId,companyId:target.companyId,terminalId:target.terminalId,binding:target.binding}));
  require(guardProof.installedVersion === '1.1.513' && /^[a-f0-9]{40}$/.test(guardProof.sourceCommit)
    && [guardProof.apkSha256,guardProof.evidenceSha256,guardProof.blockedRetryRouteSha256].every(digest)
    && guardProof.observedOnlyBlockedRetry === true && guardProof.independentlyReviewedNoInterveningIssue === true);
  require(digest(archives.financialSha256) && digest(archives.providerSha256)
    && await sha256Utf8(archives.financialText) === archives.financialSha256 && await sha256Utf8(archives.providerText) === archives.providerSha256);
  const financial=JSON.parse(archives.financialText),provider=JSON.parse(archives.providerText);
  require(financial.readOnly === true && financial.providerPostExecuted === false
    && financial.displayId === target.displayId && provider.displayId === target.displayId
    && financial.ncf === target.ncf && provider.ncf === target.ncf
    && financial.fiscalSyncError === MSELLER_UNSUPPORTED_VAT_ERROR && provider.fiscalSyncError === MSELLER_UNSUPPORTED_VAT_ERROR
    && provider.fiscalResponseMessage === MSELLER_UNSUPPORTED_VAT_ERROR && provider.fiscalProvider === 'MSELLER'
    && provider.fiscalSyncStatus === 'ERROR' && provider.fiscalProviderStatus === 'V3_ISSUE_REQUESTED'
    && !provider.fiscalReferenceId && !provider.fiscalCertifiedNcf && !provider.fiscalResponseCode && !provider.fiscalSyncedAt
    && provider.fiscalSecurityCodePresent === false && provider.fiscalQrUrlPresent === false);
  const binding=JSON.parse(scope.binding);
  require(binding[0] === scope.tenantId && binding[1] === scope.terminalId);
  for(const document of [current,history]) {
    require(document.id === target.id && document.displayId === target.displayId && document.terminalId === target.terminalId
      && document.v3Binding === scope.binding && document.ncf === target.ncf && document.electronicNcf === target.ncf
      && document.fiscalProvider === 'MSELLER' && document.fiscalSyncStatus === 'ERROR' && document.fiscalProviderStatus === 'V3_ISSUE_REQUESTED'
      && !document.fiscalClassificationProjection && !document.fiscalClassificationAttemptedAt
      && ['fiscalReferenceId','fiscalCertifiedNcf','fiscalSyncedAt','fiscalQrUrl','fiscalSecurityCode','fiscalResponseCode','fiscalSignedXml','fiscalQrCode']
        .every(key => String(document[key] ?? '').trim() === '')
      && document.fiscalSyncError === 'SYNC_V3_FISCAL_RECONCILIATION_REQUIRED'
      && document.fiscalResponseMessage === 'Existe un intento fiscal sin referencia confirmada. Requiere reconciliación antes de emitir de nuevo.');
    require(['netAmount','taxAmount','total','taxBreakdown'].every(key => same(document[key],financial[key])));
    require([document.netAmount,document.taxAmount,document.total].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0));
    require(typeof document.v3CommitFingerprint === 'string');
    const sealed=JSON.parse(JSON.parse(document.v3CommitFingerprint)[0]);
    // Compare every immutable financial field present in the sealed native commit, not a synthetic historic hash.
    require(sealed.id === target.id && Object.keys(sealed).every(key => same(sealed[key],document[key])));
    require(document.items.length > 0 && document.items.every(line => line.v3SaleAuthority?.binding === scope.binding));
  }
  require(current.v3CommitFingerprint === history.v3CommitFingerprint
    && await fiscalClassificationChecksum(current) === await fiscalClassificationChecksum(history));
  const financialChecksum=await fiscalClassificationChecksum(current);
  const summary={documentId:target.id,ncf:target.ncf,financialChecksum,archiveFullOriginalChecksumAvailable:false as const,
    transactionChecksum:await sha256Utf8(JSON.stringify(current)),historyChecksum:await sha256Utf8(JSON.stringify(history)),
    archiveFinancialSha256:archives.financialSha256,archiveProviderSha256:archives.providerSha256};
  const audit={scope,actorId:input.actorId,reason:input.reason.trim(),at:new Date().toISOString(),binding:scope.binding,
    before:{error:current.fiscalSyncError,response:current.fiscalResponseMessage},after:{error:MSELLER_UNSUPPORTED_VAT_ERROR,response:MSELLER_UNSUPPORTED_VAT_ERROR},
    ...summary,guardProof};
  const mutations=[['transactions',current],['transactionHistory',history]].map(([collection,document])=>{
    const original=document as Document;
    return {collectionName:collection as string,v3FiscalMetadataOperation:'PRESUBMIT_EVIDENCE_REPAIR' as const,v3CurrentCatalog:input.currentCatalog,
      ...(collection === 'transactionHistory' ? {v3ExpectedRetainedDocument:{collection:'transactions',id:current.id,expected:JSON.stringify(current)}} : {}),
      expectedDocument:JSON.stringify(original),document:{...original,
      fiscalSyncError:MSELLER_UNSUPPORTED_VAT_ERROR,fiscalResponseMessage:MSELLER_UNSUPPORTED_VAT_ERROR,
      fiscalPreSubmitRecoveryAudit:[...(original.fiscalPreSubmitRecoveryAudit||[]),audit]}};
  });
  const operationId=await sha256Utf8(JSON.stringify({scope,mutations,summary}));
  return {operationId,scope,mutations,summary};
}

/** Only a human-approved exact operation can reach the existing native atomic CAS adapter. */
export async function executeApprovedFiscalPresubmitEvidenceRepair(plan: PreparedFiscalEvidenceRepair,
  adapter: Pick<DatabaseAdapter,'saveDocumentsAtomically' | 'supportsV3FiscalMetadataCAS'>, currentScope: () => Promise<Scope>,
  approval: { approved: true; operationId: string }): Promise<void> {
  require(approval?.approved === true && approval.operationId === plan.operationId && same(await currentScope(),plan.scope)
    && await sha256Utf8(JSON.stringify({scope:plan.scope,mutations:plan.mutations,summary:plan.summary})) === plan.operationId);
  require(adapter.supportsV3FiscalMetadataCAS === true && adapter.saveDocumentsAtomically);
  await adapter.saveDocumentsAtomically!(plan.mutations);
}
