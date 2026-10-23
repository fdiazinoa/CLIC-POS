import type {BusinessConfig} from '../../types';
import {readTerminalCredentialsSync} from '../sync/TerminalCredentialStore';
import {resolveLocalDeviceId} from '../../utils/deviceRevocation';
import {isTerminalAuthorizationSuperseded} from '../../utils/terminalAuthorizationGuard';
import {sha256Utf8} from '../sync/LargeMasterSyncV3Client';
import {resolveSyncTarget} from '../sync/SyncProfile';
import {offlineFiscalFail,type OfflineFiscalLocalAuthority} from './OfflineFiscalLease';

/** Identity and downloaded fiscal assignment only; online bearer lifetime never grants local issuance. */
export async function offlineFiscalAuthorityFromConfig(config:BusinessConfig,
 credentials=readTerminalCredentialsSync(),deviceId=resolveLocalDeviceId()):Promise<OfflineFiscalLocalAuthority> {
 const terminalId=credentials.erpTerminalId||credentials.terminalId;
 const terminals=(config?.terminals||[]).filter(t=>(t.config?.erpTerminalId||t.id)===terminalId&&t.config?.currentDeviceId===deviceId);
 if(terminals.length!==1||!deviceId||credentials.deviceId!==deviceId||credentials.identityMigrationRequired
  ||!credentials.deviceToken||isTerminalAuthorizationSuperseded()
  ||/DEVICE_NOT_AUTHORIZED|REVOKED/i.test(credentials.authStatus||'')
  ||/DEVICE_(TOKEN_INVALID|FORBIDDEN|REVOKED|CHANGED|SUPERSEDED)|TENANT_FORBIDDEN|TERMINAL_INACTIVE|FISCAL_OFFLINE_(LEASE_REVOKED|BINDING_CHANGED|AUTHORITY_CHANGED|MASTER_REQUIRED)/i.test(credentials.lastAuthError||''))offlineFiscalFail('OFFLINE_FISCAL_BINDING_CHANGED');
 const terminal=terminals[0],local=terminal.config!,binding=local.erpBinding,fiscal=local.fiscal as any;
 const scope={tenantId:binding?.tenantId!,companyId:binding?.companyId!,storeId:binding?.storeId!,terminalId:terminalId!,deviceId};
 const issuerRnc=String(config.companyInfo?.rnc||'').replace(/[\s.-]/g,'');
 if(Object.values(scope).some(v=>typeof v!=='string'||!v)||(credentials.erpTenantId||credentials.tenantId)!==scope.tenantId
  ||credentials.companyId!==scope.companyId||credentials.storeId!==scope.storeId
  ||fiscal?.providerId!=='MSELLER'||fiscal.enabled===false||fiscal.mode!=='ECF'
  ||![0,1,2].includes(fiscal.environment)||!/^\d{9}(?:\d{2})?$/.test(issuerRnc)||fiscal.credentialKey!==issuerRnc
  ||(local as any).active===false||(local as any).is_active===false||local.isPrimaryNode!==true||local.governedByMaster===true||local.syncConfig?.mode!=='MASTER')offlineFiscalFail('OFFLINE_FISCAL_BINDING_CHANGED');
 const target=resolveSyncTarget();
 const bindingHash=await sha256Utf8(JSON.stringify({scope,issuerRnc,deviceFingerprint:await sha256Utf8(credentials.deviceToken),
  fiscal:{providerId:fiscal.providerId,enabled:fiscal.enabled!==false,mode:fiscal.mode,environment:fiscal.environment,credentialKey:fiscal.credentialKey},
  role:{isPrimaryNode:local.isPrimaryNode,governedByMaster:local.governedByMaster===true,mode:local.syncConfig.mode},
  erpSyncBase:target.kind==='ERP_ACTIVE'?target.baseUrl:null,downloadOrigin:import.meta.env?.VITE_LARGE_MASTER_SYNC_V3_BASE_URL||null}));
 return {scope,issuerRnc,environment:fiscal.environment,bindingHash};
}
export async function readOfflineFiscalLocalAuthority():Promise<OfflineFiscalLocalAuthority>{
 const {dbAdapter}=await import('../db');
 await dbAdapter.connect();
 try{return await offlineFiscalAuthorityFromConfig(await dbAdapter.getDocument<BusinessConfig>('config','current') as BusinessConfig);}
 catch(error){if(error instanceof Error&&error.message==='OFFLINE_FISCAL_BINDING_CHANGED')await dbAdapter.fiscalWorkflowStore?.revokeOfflineLeases?.('*');throw error;}
}
