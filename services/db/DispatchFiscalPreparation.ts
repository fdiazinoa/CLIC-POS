import type {FiscalWorkflowReserveOptions} from '../fiscal/FiscalWorkflowV2Types';
import type {OfflineFiscalLocalAuthority,TableFiscalSaleContext} from '../fiscal/OfflineFiscalLease';
import type {DispatchDemand} from './CompanyDispatchEscrowStore';
/** Authority selection is fixed by the fiscal client before entering the native writer queue. */
export interface DispatchFiscalPreparation {
 cartIdentity:string;operationId:string;poolId:string;demandDigest:string;source:Record<string,unknown>;demands:DispatchDemand[];
 fiscal:{kind:'PERMIT';scopeKey:string;options:FiscalWorkflowReserveOptions}|{kind:'ALLOCATION';authority:OfflineFiscalLocalAuthority;context?:TableFiscalSaleContext};
}
