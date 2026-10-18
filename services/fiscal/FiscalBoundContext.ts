import {readLargeMasterSyncV3BoundIdentity,validatedLargeMasterSyncV3ErpSyncBase,type LargeMasterSyncV3BoundIdentity} from '../sync/LargeMasterSyncV3BoundTransport';
import {readTerminalCredentialsSync,type TerminalCredentials} from '../sync/TerminalCredentialStore';
export const captureFiscalBoundContext=(readIdentity:()=>LargeMasterSyncV3BoundIdentity=readLargeMasterSyncV3BoundIdentity,readCredentials:()=>TerminalCredentials=readTerminalCredentialsSync,now=Date.now())=>{
 const identity=readIdentity(),credentials=readCredentials();
 const base=validatedLargeMasterSyncV3ErpSyncBase(identity.erpSyncBaseUrl),origin=new URL(base).origin;
 const token=(value:unknown)=>typeof value==='string'&&value.trim()===value&&value.length>0&&!/[\r\n\t]/.test(value);
 const expires=(value:unknown)=>value==null||value===''||typeof value==='string'&&Number.isFinite(Date.parse(value))&&Date.parse(value)>now;
 if((credentials.erpTenantId||credentials.tenantId)!==identity.tenantId||(credentials.erpTerminalId||credentials.terminalId)!==identity.terminalId
   ||credentials.deviceId!==identity.deviceId||credentials.syncToken!==identity.syncToken||!token(identity.syncToken)||!token(credentials.deviceToken)
   ||!credentials.companyId||!credentials.storeId||credentials.identityMigrationRequired
   ||/DEVICE_NOT_AUTHORIZED|NEEDS_REAUTH|BOUND_AUTH_MISMATCH|AUTH_ERROR|REVOKED/i.test(credentials.authStatus||'')
   ||credentials.deviceTokenSource!=='ERP_REGISTER'
   ||!expires(credentials.syncTokenExpiresAt)||!expires(credentials.deviceTokenExpiresAt))throw Error('FISCAL_TERMINAL_AUTH_REQUIRED');
 const descriptor={origin,tenantId:identity.tenantId,companyId:credentials.companyId,storeId:credentials.storeId,terminalId:identity.terminalId,deviceId:identity.deviceId};
 const fingerprint=JSON.stringify([descriptor,identity.syncToken,credentials.deviceToken,credentials.syncTokenExpiresAt,credentials.deviceTokenExpiresAt,credentials.authStatus,credentials.deviceTokenSource]);
 return {base,descriptor,headers:{Authorization:`Bearer ${identity.syncToken}`,'X-Sync-Token':identity.syncToken,'X-Terminal-Id':identity.terminalId,'X-Device-Id':identity.deviceId,'X-Device-Token':credentials.deviceToken!,'X-Tenant-Id':identity.tenantId},
  assertCurrent:()=>{const fresh=captureFiscalBoundContext(readIdentity,readCredentials,Date.now());if(fresh.fingerprint!==fingerprint)throw Error('FISCAL_SUBMISSION_SCOPE_CHANGED');},fingerprint};
};

/** Manual original-document GET only. The ERP still authenticates the live session and authorized device.
 * deviceTokenExpiresAt is retained as historical pairing evidence, never rewritten or renewed here.
 * The ISSUE context above retains its strict expiry guard.
 */
export const captureFiscalStatusBoundContext=(readIdentity:()=>LargeMasterSyncV3BoundIdentity=readLargeMasterSyncV3BoundIdentity,readCredentials:()=>TerminalCredentials=readTerminalCredentialsSync,now=Date.now())=>{
 const identity=readIdentity(),credentials=readCredentials();
 const base=validatedLargeMasterSyncV3ErpSyncBase(identity.erpSyncBaseUrl),origin=new URL(base).origin;
 const token=(value:unknown)=>typeof value==='string'&&value.trim()===value&&value.length>0&&!/[\r\n\t]/.test(value);
 if((credentials.erpTenantId||credentials.tenantId)!==identity.tenantId||(credentials.erpTerminalId||credentials.terminalId)!==identity.terminalId
   ||credentials.deviceId!==identity.deviceId||credentials.syncToken!==identity.syncToken||!token(identity.syncToken)||!token(credentials.deviceToken)
   ||!credentials.companyId||!credentials.storeId||credentials.identityMigrationRequired
   ||!['AUTHENTICATED','BOUND'].includes(credentials.authStatus||'')
   ||!['ERP_REGISTER','ERP_REGISTER_REAUTH','ERP_REGISTER_REFRESH','ERP_AUTH_REAUTH','ERP_AUTH_REFRESH'].includes(credentials.deviceTokenSource||'')
   ||!credentials.syncTokenExpiresAt||!Number.isFinite(Date.parse(credentials.syncTokenExpiresAt))||Date.parse(credentials.syncTokenExpiresAt)<=now
   ||credentials.deviceTokenExpiresAt&&!Number.isFinite(Date.parse(credentials.deviceTokenExpiresAt)))throw Error('FISCAL_TERMINAL_AUTH_REQUIRED');
 const descriptor={origin,tenantId:identity.tenantId,companyId:credentials.companyId,storeId:credentials.storeId,terminalId:identity.terminalId,deviceId:identity.deviceId};
 // Both dates remain in the race fingerprint. Only the live session expiry authorizes this status GET.
 const fingerprint=JSON.stringify([descriptor,identity.syncToken,credentials.deviceToken,credentials.syncTokenExpiresAt,credentials.deviceTokenExpiresAt,credentials.authStatus,credentials.deviceTokenSource]);
 return {base,descriptor,headers:{Authorization:`Bearer ${identity.syncToken}`,'X-Sync-Token':identity.syncToken,'X-Terminal-Id':identity.terminalId,'X-Device-Id':identity.deviceId,'X-Device-Token':credentials.deviceToken!,'X-Tenant-Id':identity.tenantId},
  assertCurrent:()=>{const fresh=captureFiscalStatusBoundContext(readIdentity,readCredentials,Date.now());if(fresh.fingerprint!==fingerprint)throw Error('FISCAL_SUBMISSION_SCOPE_CHANGED');},fingerprint};
};
