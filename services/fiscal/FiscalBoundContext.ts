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
