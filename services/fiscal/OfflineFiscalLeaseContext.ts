import type {BusinessConfig} from '../../types';
import {readTerminalCredentialsSync} from '../sync/TerminalCredentialStore';
import {resolveLocalDeviceId} from '../../utils/deviceRevocation';
import {isTerminalAuthorizationSuperseded} from '../../utils/terminalAuthorizationGuard';
import {sha256Utf8} from '../sync/LargeMasterSyncV3Client';
import {offlineFiscalFail,type OfflineFiscalLocalAuthority} from './OfflineFiscalLease';

type FiscalAuthorityConfig = Pick<BusinessConfig, 'companyInfo' | 'terminals'>;
type TerminalCredentials=ReturnType<typeof readTerminalCredentialsSync>;

/** The local bearer/device credential is transport, never fiscal identity. A degraded session is
 * reported with this code instead of the destructive `OFFLINE_FISCAL_BINDING_CHANGED`. */
export const OFFLINE_FISCAL_SESSION_UNAVAILABLE='OFFLINE_FISCAL_SESSION_UNAVAILABLE';

export interface OfflineFiscalSessionState {verified:boolean;code:string|null;detail:string|null}

const sessionFault=(credentials:TerminalCredentials):{code:string;detail:string}|null=>{
 if(!credentials.deviceToken)return {code:'SESSION_DEVICE_TOKEN_MISSING',detail:'La credencial local no tiene token de dispositivo.'};
 if(isTerminalAuthorizationSuperseded())return {code:'SESSION_DEVICE_SUPERSEDED',detail:'La autorización de la terminal fue reemplazada.'};
 const status=String(credentials.authStatus||'');
 if(/DEVICE_NOT_AUTHORIZED|REVOKED/i.test(status))return {code:'SESSION_DEVICE_NOT_AUTHORIZED',detail:status};
 const previous=String(credentials.lastAuthError||'');
 if(/DEVICE_(TOKEN_INVALID|FORBIDDEN|REVOKED|CHANGED|SUPERSEDED)|TENANT_FORBIDDEN|TERMINAL_INACTIVE|FISCAL_OFFLINE_(LEASE_REVOKED|BINDING_CHANGED|AUTHORITY_CHANGED|MASTER_REQUIRED)/i.test(previous))return {code:'SESSION_AUTH_ERROR',detail:previous};
 if(credentials.identityMigrationRequired)return {code:'SESSION_MIGRATION_REQUIRED',detail:'Las credenciales locales requieren migración de identidad.'};
 return null;
};
/** Pure read of the local session/transport health. It never throws and never revokes anything. */
export function offlineFiscalSessionState(credentials=readTerminalCredentialsSync()):OfflineFiscalSessionState{
 const fault=sessionFault(credentials);
 return fault?{verified:false,code:OFFLINE_FISCAL_SESSION_UNAVAILABLE,detail:`${fault.code}: ${fault.detail}`}:{verified:true,code:null,detail:null};
}

/** Fiscal identity of the downloaded grant: scope + issuer + fiscal configuration + role.
 * Deliberately excludes the rotating device token, the mutable sync base and any session health:
 * those change while the fiscal assignment stays valid, and including them revoked live reserves. */
const fiscalIdentityPayload=(input:{scope:Record<string,unknown>;issuerRnc:string;fiscal:{providerId:string;enabled:boolean;mode:string;environment:0|1|2;credentialKey:string};role:{isPrimaryNode:boolean;governedByMaster:boolean;mode:string}})=>({
 scope:input.scope,issuerRnc:input.issuerRnc,
 fiscal:{providerId:input.fiscal.providerId,enabled:input.fiscal.enabled,mode:input.fiscal.mode,environment:input.fiscal.environment,credentialKey:input.fiscal.credentialKey},
 role:{isPrimaryNode:input.role.isPrimaryNode,governedByMaster:input.role.governedByMaster,mode:input.role.mode},
 downloadOrigin:import.meta.env?.VITE_LARGE_MASTER_SYNC_V3_BASE_URL||null,
});

const bindingChanged = (bindingReason: 'LOCAL_DEVICE' | 'LOCAL_AUTHORIZATION' | 'ERP_SCOPE' | 'FISCAL_ISSUER' | 'MASTER_ROLE'): never => {
 throw Object.assign(new Error('OFFLINE_FISCAL_BINDING_CHANGED'), {bindingReason});
};

/** Identity and downloaded fiscal assignment only; online bearer lifetime never grants local issuance. */
export async function offlineFiscalAuthorityFromConfig(config:FiscalAuthorityConfig|null,
 credentials=readTerminalCredentialsSync(),deviceId=resolveLocalDeviceId(),
 options:{requireTransportVerified?:boolean}={}):Promise<OfflineFiscalLocalAuthority> {
 const terminalId=credentials.erpTerminalId||credentials.terminalId;
 const terminals=(config?.terminals||[]).filter(t=>(t.config?.erpTerminalId||t.id)===terminalId&&t.config?.currentDeviceId===deviceId);
 // The durable identity is the fiscal scope/terminal/device pairing. Session token, authStatus and
 // lastAuthError are deliberately NOT part of it: an expired session cannot change the assignment.
 if(terminals.length!==1||!deviceId||credentials.deviceId!==deviceId)bindingChanged('LOCAL_DEVICE');
 if(options.requireTransportVerified&&sessionFault(credentials))offlineFiscalFail(OFFLINE_FISCAL_SESSION_UNAVAILABLE);
 const terminal=terminals[0],local=terminal.config!,binding=local.erpBinding,fiscal=local.fiscal as any;
 const scope={tenantId:binding?.tenantId!,companyId:binding?.companyId!,storeId:binding?.storeId!,terminalId:terminalId!,deviceId};
 const issuerRnc=String(config!.companyInfo?.rnc||'').replace(/[\s.-]/g,'');
 if(Object.values(scope).some(v=>typeof v!=='string'||!v)||(credentials.erpTenantId||credentials.tenantId)!==scope.tenantId
  ||credentials.companyId!==scope.companyId||credentials.storeId!==scope.storeId)bindingChanged('ERP_SCOPE');
 if(fiscal?.providerId!=='MSELLER'||fiscal.enabled===false||fiscal.mode!=='ECF'
  ||![0,1,2].includes(fiscal.environment)||!/^\d{9}(?:\d{2})?$/.test(issuerRnc)||fiscal.credentialKey!==issuerRnc)bindingChanged('FISCAL_ISSUER');
 if((local as any).active===false||(local as any).is_active===false||local.isPrimaryNode!==true||local.governedByMaster===true||local.syncConfig?.mode!=='MASTER')bindingChanged('MASTER_ROLE');
 const bindingHash=await sha256Utf8(JSON.stringify(fiscalIdentityPayload({scope,issuerRnc,fiscal,
  role:{isPrimaryNode:local.isPrimaryNode===true,governedByMaster:local.governedByMaster===true,mode:local.syncConfig.mode}})));
 return {scope,issuerRnc,environment:fiscal.environment,bindingHash};
}
/** Pure fiscal identity read. A session/transport fault no longer reaches this path and a local
 * mismatch is never resolved by mutating storage: callers quarantine in memory and report a reason. */
export async function readOfflineFiscalLocalAuthority():Promise<OfflineFiscalLocalAuthority>{
 const {dbAdapter}=await import('../db');
 await dbAdapter.connect();
 const config = dbAdapter.readOfflineFiscalAuthorityConfig
  ? await dbAdapter.readOfflineFiscalAuthorityConfig()
  : await dbAdapter.getDocument<FiscalAuthorityConfig>('config','current');
 return offlineFiscalAuthorityFromConfig(config);
}
/** Binding hashes written by older builds cannot be recomputed (they mixed the rotating device token
 * and the mutable erpSyncBase), so a stored checkout is accepted either by the current identity hash
 * or by a local reserve proof already validated against that same fiscal identity at this read. */
export async function offlineFiscalBindingCompatible(storedHash:string|null|undefined,
 authority:OfflineFiscalLocalAuthority,options:{localReserveValidated?:boolean}={}):Promise<boolean>{
 if(storedHash===authority.bindingHash)return true;
 return options.localReserveValidated===true;
}
