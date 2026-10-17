import {captureFiscalBoundContext} from './FiscalBoundContext';
import {readTerminalCredentialsSync,type TerminalCredentials} from '../sync/TerminalCredentialStore';
import type { Transaction } from '../../types';
import type { FiscalStatusScope,FiscalStatusProof } from './FiscalStatusProof';
import { readLargeMasterSyncV3BoundIdentity,type LargeMasterSyncV3BoundIdentity } from '../sync/LargeMasterSyncV3BoundTransport';

/** Exact authenticated GET only; no legacy/provider endpoint fallback or normalized lookup receipt. */
export async function getScopedFiscalDocumentStatus(tx: Transaction,scope: FiscalStatusScope,
  readIdentity: ()=>LargeMasterSyncV3BoundIdentity=readLargeMasterSyncV3BoundIdentity,fetchImpl: typeof fetch=fetch,readCredentials:()=>TerminalCredentials=readTerminalCredentialsSync): Promise<FiscalStatusProof> {
  const auth=captureFiscalBoundContext(readIdentity,readCredentials);
  const scopeKeys=['tenantId','companyId','storeId','terminalId','deviceId'] as const;
  if(scopeKeys.some(key=>auth.descriptor[key]!==scope[key]))throw Error('FISCAL_STATUS_SCOPE_CHANGED');
  const {binding:_binding,approvedById:_actor,...scopeAssertion}=scope;
  const params=new URLSearchParams({sourceTransactionId:tx.id,electronicNcf:tx.electronicNcf||tx.ncf||'',scopeAssertion:JSON.stringify(scopeAssertion)});
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),5000);
  try{
    auth.assertCurrent();
    const response=await fetchImpl(`${auth.base}/v3/fiscal/documents/status?${params}`,{method:'GET',headers:{Accept:'application/json',
      ...auth.headers},credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal});
    const payload=await response.json();auth.assertCurrent();
    if(!response.ok||payload?.schemaVersion!==1||payload?.source!=='ERP_SCOPED_PROVIDER_GET')throw Error('FISCAL_STATUS_PROOF_UNAVAILABLE');
    return payload as FiscalStatusProof;
  }finally{clearTimeout(timeout);}
}
