import type { Transaction } from '../../types';
import { sha256Utf8 } from '../sync/LargeMasterSyncV3Client';

export interface FiscalStatusScope {
  basis: 'PERSISTED_SUBMISSION_INTENT' | 'EXPLICIT_AUTHORIZED_LOOKUP';
  providerId: 'MSELLER'; environment: number; issuerRnc: string;
  tenantId: string; companyId: string; terminalId: string; deviceId: string; storeId: string;
  binding: string; sourceChecksum: string; capturedAt: string;
  approvedById?: string;
}
export interface FiscalStatusProof {
  schemaVersion: 1; source: 'ERP_SCOPED_PROVIDER_GET' | 'ERP_SCOPED_PROVIDER_ISSUE';
  scope: { tenantId: string; companyId: string; terminalId: string; deviceId: string; storeId: string };
  document: { erpDocumentId: string; sourceTransactionId: string; ncf: string; ncfType: string; sourceChecksum: string; total: number };
  issuer: { rnc: string; providerId: 'MSELLER'; environment: number; credentialCompanyId: string; credentialAccountRnc: string };
  environmentBasis: FiscalStatusScope['basis'] | 'HISTORICAL_SOURCE'; historicalEnvironment: number | null;
  lookup: { requestedNcf: string };
  providerReceipt: { returnedNcf: string; internalTrackId: string; status: string; success: boolean | null; pending: boolean | null; invoiceTotal: number | null; printEvidence?: import('./FiscalPrintEvidence').FiscalPrintEvidence };
  decision: 'ACCEPTED' | 'PENDING' | 'REJECTED' | 'HELD'; observedAt: string;
}
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
/** New status contract only. Never changes the old classification/native fingerprint protocols. */
export const fiscalStatusSourceChecksum = (tx: Transaction): Promise<string> => sha256Utf8(JSON.stringify(canonical([
  tx.id,tx.terminalId,tx.ncf,tx.electronicNcf,tx.ncfType,tx.customerId,tx.customerSnapshot,tx.items,tx.payments,
  tx.netAmount,tx.taxAmount,tx.total,tx.discountAmount,tx.discountType,tx.discountValue,tx.taxBreakdown,
  tx.serviceChargeAmount,tx.serviceTaxPolicySnapshot,tx.date,
])));
export const fiscalNcfIdentity = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const match=/^(E31|E32|E34|E44|E45)([0-9]{1,10})$/.exec(value);
  if (!match || /^0+$/.test(match[2])) return undefined;
  return match[1]+':'+match[2].replace(/^0+/,'');
};
export const sameFiscalNcf = (a: unknown,b: unknown): boolean => Boolean(fiscalNcfIdentity(a) && fiscalNcfIdentity(a)===fiscalNcfIdentity(b));
export const acceptedFiscalStatus = (value: unknown): boolean => typeof value === 'string'
  && ['ACEPTADO','DGIIACEPTADO','ACCEPTED','APPROVED'].includes(value.trim().toUpperCase());
export const validFiscalScope = (scope: FiscalStatusScope, tx: Transaction): boolean => {
  let binding: any;try{binding=JSON.parse(scope.binding);}catch{return false;}
  return ['PERSISTED_SUBMISSION_INTENT','EXPLICIT_AUTHORIZED_LOOKUP'].includes(scope.basis) && scope.providerId==='MSELLER' && tx.fiscalProvider==='MSELLER'
    && Boolean(fiscalNcfIdentity(tx.electronicNcf||tx.ncf)?.startsWith(String(tx.ncfType)+':'))
    && Number.isInteger(scope.environment) && [0,1,2].includes(scope.environment) && /^(?:\d{9}|\d{11})$/.test(scope.issuerRnc)
    && Boolean(scope.tenantId&&scope.companyId&&scope.terminalId&&scope.deviceId&&scope.storeId) && binding[0]===scope.tenantId
    && binding[1]===scope.terminalId&&binding[2]===scope.deviceId&&scope.terminalId===tx.terminalId
    && (tx as any).v3Binding===scope.binding && tx.items.every(line=>line.v3SaleAuthority?.binding===scope.binding)
    && /^[a-f0-9]{64}$/.test(scope.sourceChecksum)&&Number.isFinite(Date.parse(scope.capturedAt))
    && (scope.basis!=='EXPLICIT_AUTHORIZED_LOOKUP'||Boolean(scope.approvedById));
};
export async function verifyFiscalStatusProof(proof: FiscalStatusProof, scope: FiscalStatusScope, tx: Transaction, requireAccepted=true): Promise<boolean> {
  if (!proof || !validFiscalScope(scope,tx) || scope.sourceChecksum!==await fiscalStatusSourceChecksum(tx)) return false;
  const p=proof;
  return p.schemaVersion===1&&(p.source==='ERP_SCOPED_PROVIDER_GET'||!requireAccepted&&p.source==='ERP_SCOPED_PROVIDER_ISSUE')&&(!requireAccepted||p.decision==='ACCEPTED')
    && p.scope?.tenantId===scope.tenantId&&p.scope.companyId===scope.companyId&&p.scope.terminalId===scope.terminalId&&p.scope.deviceId===scope.deviceId
    && p.scope.storeId===scope.storeId
    && p.issuer?.providerId==='MSELLER'&&p.issuer.rnc===scope.issuerRnc&&p.issuer.credentialAccountRnc===scope.issuerRnc
    && p.issuer.credentialCompanyId===scope.companyId&&p.issuer.environment===scope.environment
    && (p.environmentBasis===scope.basis||p.environmentBasis==='HISTORICAL_SOURCE'&&p.historicalEnvironment===scope.environment)
    && (p.historicalEnvironment===null||p.historicalEnvironment===scope.environment)
    && p.document?.sourceTransactionId===tx.id&&Boolean(p.document.erpDocumentId)&&p.document.sourceChecksum===scope.sourceChecksum
    && p.document.ncfType===tx.ncfType&&sameFiscalNcf(p.document.ncf,tx.electronicNcf||tx.ncf)
    && sameFiscalNcf(p.lookup?.requestedNcf,tx.electronicNcf||tx.ncf)
    && sameFiscalNcf(p.providerReceipt?.returnedNcf,tx.electronicNcf||tx.ncf)&&Boolean(p.providerReceipt.internalTrackId?.trim())
    && (!requireAccepted||acceptedFiscalStatus(p.providerReceipt.status)&&p.providerReceipt.success!==false&&p.providerReceipt.pending!==true)
    && typeof p.document.total==='number'&&Number.isFinite(p.document.total)&&Math.abs(p.document.total-tx.total)<0.005
    && typeof p.providerReceipt.invoiceTotal==='number'&&Number.isFinite(p.providerReceipt.invoiceTotal)&&Math.abs(p.providerReceipt.invoiceTotal-tx.total)<0.005
    && Number.isFinite(Date.parse(p.observedAt));
}

/** Only an exact scoped GET can record rejection of the original submission. */
export async function verifyRejectedFiscalStatusProof(proof: FiscalStatusProof,scope: FiscalStatusScope,tx: Transaction):Promise<boolean>{
 return proof?.source==='ERP_SCOPED_PROVIDER_GET'&&proof.decision==='REJECTED'
  && ['RECHAZADO','DGIIRECHAZADO','REJECTED'].includes(String(proof.providerReceipt?.status).trim().toUpperCase())
  && proof.providerReceipt.success===false&&proof.providerReceipt.pending===false
  && await verifyFiscalStatusProof(proof,scope,tx,false);
}
export const matchesOriginalFiscalReference=(proof:FiscalStatusProof,tx:Transaction):boolean=>
 (!tx.fiscalReferenceId||tx.fiscalReferenceId===proof.providerReceipt?.internalTrackId)
 && (!tx.fiscalCertifiedNcf||sameFiscalNcf(tx.fiscalCertifiedNcf,proof.providerReceipt?.returnedNcf))
 && (!tx.ncf||sameFiscalNcf(tx.ncf,tx.electronicNcf||tx.ncf));
