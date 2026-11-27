/** Offline/fiscal failure classification for the V3 operational POS.
 * The RED blocking banner is reserved for a real fiscal identity change or for the absence of a valid
 * local reserve. A session/transport/reconciliation fault with a usable local reserve is a non-blocking
 * warning: the cashier keeps operating and the failure is reconciled when the connection returns.
 * This module is pure so both the component and the tests can decide without a DOM or a database. */

export type OfflineFiscalFailureSeverity='DEGRADED'|'BLOCKING';

export interface OfflineFiscalFailureDecision {
 blocking:boolean;
 severity:OfflineFiscalFailureSeverity;
 title:string;
 detail:string;
 retry:boolean;
 reason:string;
}

/** Only session/transport/offline-reserve/reconciliation faults may degrade to an amber warning.
 * Anything else (catalog, tariff, native store, article resolution…) is a real failure and must keep
 * the blocking banner: calling it "can still charge offline" would hide a non-offline cause. */
const DEGRADABLE:RegExp[]=[
 /^OFFLINE_FISCAL_SESSION_UNAVAILABLE$/,
 /^OFFLINE_FISCAL_PREPARATION_(FAILED|DISABLED|TIMEOUT)$/,
 /^OFFLINE_FISCAL_RESERVE_QUARANTINED/,
 // Local reserve present but its fiscal read had to fall back / was unavailable offline.
 /^SYNC_V3_OFFLINE_(AUTHORITY|CACHED_RUNTIME)_REQUIRED$/,
 // Transport failures of the ERP transport, not data availability.
 /^SYNC_V3_(HTTP_TEMPORARY|TIMEOUT)$/,
 /^(Failed to fetch|Load failed|NetworkError|TypeError: Failed to fetch)$/i,
 /^net::ERR_/i,
 // Fiscal workflow disabled/unavailable or an attempt that needs reconciliation (with a valid reserve).
 /^FISCAL_WORKFLOW_(UNAVAILABLE|DISABLED|CONTEXT_CHANGED)$/,
 /^FISCAL_WORKFLOW_CHECKOUT_RECONCILIATION/,
];

/** Explicit non-offline availability faults. They are data/feature failures, never an offline banner. */
const UNAVAILABLE_IS_NOT_OFFLINE=/^SYNC_V3_(TARIFF|CATALOG|CATEGORY|NATIVE_STORE|ARTICLE|EXACT_CODE|INVENTORY|STOCK|PRODUCT)[A-Z_]*_UNAVAILABLE$/;

/** A real fiscal identity/binding change must never be degraded: it needs an explicit re-pair. */
const FATAL_IDENTITY=/^(OFFLINE_FISCAL_BINDING_CHANGED|SYNC_V3_BINDING_CHANGED|FISCAL_WORKFLOW_SCOPE_CHANGED|FISCAL_WORKFLOW_DEVICE_CHANGED|SYNC_V3_OFFLINE_FINANCIAL_AUTHORITY_REQUIRED)/;

export const isDegradableOfflineFiscalFailure=(failure:string):boolean=>{
 const code=String(failure||'').trim();
 if(!code||FATAL_IDENTITY.test(code)||UNAVAILABLE_IS_NOT_OFFLINE.test(code))return false;
 return DEGRADABLE.some(pattern=>pattern.test(code));
};

/** Local identity reads that may fall back to the configured terminal while the ERP cannot be read. */
export const isDegradableOfflineIdentityFailure=(code:string):boolean=>{
 const value=String(code||'').trim();
 if(!value||FATAL_IDENTITY.test(value))return false;
 return value==='OFFLINE_FISCAL_SESSION_UNAVAILABLE'
  ||value==='SYNC_V3_OFFLINE_AUTHORITY_REQUIRED'
  ||/^FISCAL_WORKFLOW_CHECKOUT_RECONCILIATION/.test(value);
};

const REASONS:Record<string,string>={
 AUTHORITY_REVOKED:'La autoridad fiscal local fue revocada por el ERP.',
 AUTHORITY_CHANGED:'La autorización local pertenece a otra identidad fiscal.',
 EXPIRED_V1:'La reserva de comprobantes locales venció.',
 CLOCK_ROLLBACK:'El reloj del equipo retrocedió; corrige la fecha y hora antes de cobrar.',
 MISSING_AUTHORIZATION:'Esta caja no tiene comprobantes fiscales descargados para operar offline.',
 FISCAL_RANGE_EXHAUSTED:'Los comprobantes de la reserva local se agotaron.',
 FISCAL_RANGE_EXPIRED:'El rango fiscal de la reserva local venció.',
 PREPARATION_DISABLED:'El ERP no entrega reserva fiscal offline a esta caja.',
 PREPARATION_FAILED:'No se pudo preparar la reserva fiscal local.',
 PREPARATION_RETRY_REQUIRED:'El ERP rechazó la operación de reserva reutilizada; la caja rotará la operación y reintentará una vez.',
 READY_ALLOCATION:'La asignación fiscal local está disponible.',
 READY_V1:'La reserva fiscal local está disponible.',
};

export const offlineFiscalFailureReason=(readinessReason?:string,readinessCode?:string):string=>{
 const reason=String(readinessReason||'').trim(),code=String(readinessCode||'').trim();
 const base=REASONS[reason]||`No hay una reserva fiscal local válida (${reason||'MISSING_AUTHORIZATION'}).`;
 return code?`${base} Código: ${code}`:base;
};

export function offlineFiscalFailureDecision(input:{failure:string;authorityFailure?:boolean;offlineReady:boolean;readinessReason?:string;readinessCode?:string}):OfflineFiscalFailureDecision {
 const failure=String(input.failure||'').trim();
 const degradable=!input.authorityFailure&&isDegradableOfflineFiscalFailure(failure);
 const reason=offlineFiscalFailureReason(input.readinessReason,input.readinessCode);
 if(degradable&&input.offlineReady)return {
  blocking:false,severity:'DEGRADED',retry:true,reason,
  title:'Operación offline con reserva local',
  detail:`La conexión o la sesión no está verificada, pero la caja conserva comprobantes locales usables. Puedes seguir cobrando; la reserva se reconcilia al volver la conexión.`,
 };
 // A degraded cause without a reserve explains itself with the reserve reason; any other cause is a real
 // failure (identity, config, catalog/tariff/store) and must be reported as such, never as "no reserve".
 if(degradable)return {
  blocking:true,severity:'BLOCKING',retry:true,reason,
  title:'Caja detenida: reserva fiscal local no disponible',
  detail:`${reason} La sesión de red tampoco pudo verificarse.`,
 };
 const hint=FATAL_IDENTITY.test(failure)
  ? 'La vinculación fiscal o la identidad del dispositivo cambió; re-autoriza la terminal en Ajustes.'
  : 'La caja no puede continuar por un fallo de configuración o de datos del catálogo; no es un problema de conexión.';
 return {
  blocking:true,severity:'BLOCKING',retry:true,reason:failure||reason,
  title:'Caja detenida: fallo no relacionado con la conexión',
  detail:`${hint}${failure?` Detalle: ${failure}`:''}`,
 };
}
