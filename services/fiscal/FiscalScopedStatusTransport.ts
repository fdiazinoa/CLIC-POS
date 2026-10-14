import type { Transaction } from '../../types';
import type { FiscalStatusScope,FiscalStatusProof } from './FiscalStatusProof';
import { readLargeMasterSyncV3BoundIdentity,validatedLargeMasterSyncV3ErpSyncBase,type LargeMasterSyncV3BoundIdentity } from '../sync/LargeMasterSyncV3BoundTransport';

/** Exact authenticated GET only; no legacy/provider endpoint fallback or normalized lookup receipt. */
export async function getScopedFiscalDocumentStatus(tx: Transaction,scope: FiscalStatusScope,
  readIdentity: ()=>LargeMasterSyncV3BoundIdentity=readLargeMasterSyncV3BoundIdentity,fetchImpl: typeof fetch=fetch): Promise<FiscalStatusProof> {
  const identity=readIdentity(),base=validatedLargeMasterSyncV3ErpSyncBase(identity.erpSyncBaseUrl);
  const capture=JSON.stringify([identity.erpSyncBaseUrl,identity.tenantId,identity.terminalId,identity.deviceId,identity.syncToken]);
  if(identity.tenantId!==scope.tenantId||identity.terminalId!==scope.terminalId||identity.deviceId!==scope.deviceId)throw Error('FISCAL_STATUS_SCOPE_CHANGED');
  const {binding:_binding,approvedById:_actor,...scopeAssertion}=scope;
  const params=new URLSearchParams({sourceTransactionId:tx.id,electronicNcf:tx.electronicNcf||tx.ncf||'',scopeAssertion:JSON.stringify(scopeAssertion)});
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),5000);
  try{
    const response=await fetchImpl(`${base}/v3/fiscal/documents/status?${params}`,{method:'GET',headers:{Accept:'application/json',
      'X-Sync-Token':identity.syncToken,'X-Tenant-Id':identity.tenantId,'X-Terminal-Id':identity.terminalId,
      'X-Device-Id':identity.deviceId,'X-POS-Device-Id':identity.deviceId},credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal});
    const payload=await response.json();
    const fresh=readIdentity();
    if(JSON.stringify([fresh.erpSyncBaseUrl,fresh.tenantId,fresh.terminalId,fresh.deviceId,fresh.syncToken])!==capture)throw Error('FISCAL_STATUS_SCOPE_CHANGED');
    if(!response.ok||payload?.schemaVersion!==1||payload?.source!=='ERP_SCOPED_PROVIDER_GET')throw Error('FISCAL_STATUS_PROOF_UNAVAILABLE');
    return payload as FiscalStatusProof;
  }finally{clearTimeout(timeout);}
}
