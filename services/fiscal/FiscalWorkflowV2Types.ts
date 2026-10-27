import type {Transaction} from '../../types';
export interface FiscalWorkflowScope {tenantId:string;companyId:string;storeId:string;terminalId:string;deviceId:string}
export interface FiscalWorkflowPermitV2 {schemaVersion:2;permitId:string;transactionId:string;nonce:string;createdAt:string;expiresAt:string;scope:FiscalWorkflowScope;issuerRnc:string;environment:0|1|2;authorityHash:string;operationKind:'SALE'|'RETURN'|'VOID';originalReference?:{documentId:string;transactionId:string;ncf:string;issuerRnc:string;environment:0|1|2;sourceChecksum:string};state?:string;leaseId?:string}
export interface FiscalWorkflowPermitBirthV2 {schemaVersion:2;permitId:string;transactionId:string;nonce:string;checkoutId:string}
export type FiscalWorkflowBirthV2=FiscalWorkflowPermitBirthV2|import('./OfflineFiscalAllocation').OfflineFiscalAllocationBirth;
export interface FiscalWorkflowCheckoutV2 {allocation?:import('./OfflineFiscalAllocation').OfflineFiscalAllocationSelection;allocationIssuance?:import('../../types').FiscalIssuanceSnapshot;committedNumbering?:{displayId?:string;globalSequence?:number;seriesNumber?:number};checkoutId:string;operationId:string;transactionId:string;scopeKey:string;cartIdentity:string;permit:FiscalWorkflowPermitV2|null;phase:'PREPARED'|'EFFECT_POSSIBLE'|'COMMITTED'|'ACKNOWLEDGED';paymentIds:string[];offlineBindingHash?:string;offlineSaleDate?:string;offlineEffectAt?:string;fiscalSaleContext?:import('./OfflineFiscalLease').TableFiscalSaleContext}
export interface FiscalWorkflowPreparedRecovery {
 scopeKey:string;checkoutId:string;transactionId:string;operationId:string;cartIdentity:string;phase:'PREPARED';paymentIds:[];
}
export interface FiscalWorkflowReserveOptions {requirePermit?:boolean;authorityHash?:string;expectedCurrent?:FiscalWorkflowPreparedRecovery;offline?:{authority:import('./OfflineFiscalLease').OfflineFiscalLocalAuthority;leaseId:string;allowPaidRecovery?:boolean;fiscalSaleContext?:import('./OfflineFiscalLease').TableFiscalSaleContext}}
export interface FiscalWorkflowStateV2 {schemaVersion:2;source:'ERP_POS_FISCAL_WORKFLOW_V2';sourceKind?:'ORDINARY_SOURCE_V2'|'FORMAT_SOURCE_V2';documentId?:string;documentDate?:string;mode:'WORKFLOW'|'STATUS_ONLY';transactionId:string;workflowId:string|null;permitId:string|null;scope:FiscalWorkflowScope;issuerRnc:string;environment:number;ncf:string;ncfType:string;originalDigestV2:string;checksumV1:string|null;currency:string;exchangeRate:number;total:number;saleEventId:string|null;originalSourceEnvelope:Record<string,any>;state:string;decision:'PENDING'|'ACCEPTED'|'ACCEPTED_CONDITIONAL'|'REJECTED';signature:{schemaVersion:1;qrUrl:string;securityCode:string;signedAt:string}|null;draftRevision:number;buyer:Record<string,string>;projectionDigest:string|null;observationVersion:number;canCorrect:boolean;reason:string|null;history:Array<Record<string,any>>;observedAt:string}
export interface FiscalWorkflowStore {
 saveAllocation?(value:import('./OfflineFiscalAllocation').OfflineFiscalAllocation,authority:import('./OfflineFiscalLease').OfflineFiscalLocalAuthority,serverTime:string):Promise<void>;
 offlineAllocation?(authority:import('./OfflineFiscalLease').OfflineFiscalLocalAuthority,id?:string,recovery?:boolean):Promise<{authority:import('./OfflineFiscalAllocation').OfflineFiscalAllocation;now:number}|null>;
 reserveAllocationCheckout?(authority:import('./OfflineFiscalLease').OfflineFiscalLocalAuthority,cartIdentity:string,operationId:string,context?:import('./OfflineFiscalLease').TableFiscalSaleContext):Promise<FiscalWorkflowCheckoutV2>;
 allocationAvailability?(authority:import('./OfflineFiscalLease').OfflineFiscalLocalAuthority,type?:string):Promise<{authorizationId:string;remaining:Record<string,number>;total?:Record<string,number>}|null>;
 allocationCommitPreconditions?(checkout:FiscalWorkflowCheckoutV2):Promise<Array<{collection:string;id:string;expected:string|null}>>;
 allocationDraft?(checkout:FiscalWorkflowCheckoutV2):Promise<{ncf:string;fiscalIssuance:import('../../types').FiscalIssuanceSnapshot;fiscalEnvironment:0|1|2}>;

 checkoutForTable?(scopeKey:string,accountId:string,tableId:string):Promise<FiscalWorkflowCheckoutV2|null>;
 abandonedOfflineOperation?(scopeKey:string,operationId:string):Promise<FiscalWorkflowCheckoutV2|null>;
 abandonOfflinePrepared?(expected:FiscalWorkflowCheckoutV2):Promise<void>;
 abandonPreparedWithoutEffects?(expected:FiscalWorkflowCheckoutV2):Promise<void>;
 releaseAttemptWithoutErp?(expected:FiscalWorkflowCheckoutV2,actor:string):Promise<void>;
 saveOfflineLeasePage?(lease:import('./OfflineFiscalLease').OfflineFiscalLease,permits:FiscalWorkflowPermitV2[],authority:import('./OfflineFiscalLease').OfflineFiscalLocalAuthority,serverTime:string):Promise<void>;
 offlineLease?(authority:import('./OfflineFiscalLease').OfflineFiscalLocalAuthority,allowExpired?:boolean,leaseId?:string):Promise<import('./OfflineFiscalLease').OfflineFiscalLease|null>;
 offlineLeaseReason?(authority:import('./OfflineFiscalLease').OfflineFiscalLocalAuthority):Promise<string>;
 offlineLeasePermitCount?(leaseId:string,availableOnly?:boolean):Promise<number>;
 revokeAllocations?(scopeKey:string):Promise<void>;
 revokeOfflineLeases?(scopeKey:string):Promise<void>;
 refillOperation(scopeKey:string):Promise<string>;
 savePermits(scopeKey:string,operationId:string,permits:FiscalWorkflowPermitV2[]):Promise<void>;
 reserveCheckout(scopeKey:string,cartIdentity:string,selection?:{operationKind:'RETURN'|'VOID';originalReference:NonNullable<FiscalWorkflowPermitV2['originalReference']>},operationId?:string,options?:FiscalWorkflowReserveOptions):Promise<FiscalWorkflowCheckoutV2>;
 markPaymentPossible(checkoutId:string,paymentId:string):Promise<void>;
 acknowledgeCheckout(checkoutId:string):Promise<void>;
 currentCheckout(scopeKey:string):Promise<FiscalWorkflowCheckoutV2|null>;
 readCheckout(checkoutId:string):Promise<FiscalWorkflowCheckoutV2|null>;
 readState(transactionId:string):Promise<FiscalWorkflowStateV2|null>;
 saveState(source:Transaction,state:FiscalWorkflowStateV2,expectedVersion:number|null):Promise<void>;
 retirement?(scopeKey:string):Promise<FiscalRetirementRecord|null>;
 beginRetirement?(scopeKey:string,expected:FiscalRetirementProof):Promise<FiscalRetirementRecord>;
 completeRetirement?(scopeKey:string,receipt:FiscalRetirementReceipt):Promise<FiscalRetirementRecord>;
 closeUnbornRetirement?(scopeKey:string,proof:FiscalRetirementProof,receipt:FiscalRetirementReceipt):Promise<FiscalRetirementRecord>;
 candidates(scopeKey:string,afterId:string,limit:number):Promise<string[]>;
}

export const fiscalWorkflowScopeKey=(scope:FiscalWorkflowScope):string=>JSON.stringify(Object.fromEntries(Object.keys(scope).sort().map(key=>[key,(scope as any)[key]])));

export interface FiscalRetirementProof {schemaVersion:1;commandId:string;checkoutId:string;permitId:string;transactionId:string;originalOperationId:string;cartIdentitySha256:string;reason:'EXPIRED_PREPARED_NO_EFFECTS'}
export interface FiscalRetirementReceipt extends FiscalRetirementProof {scope:FiscalWorkflowScope;state:'HELD';closedAt:string;historyId:string}
export interface FiscalRetirementRecord extends FiscalRetirementProof {scopeKey:string;phase:'CLOSING'|'CLOSED';receipt:FiscalRetirementReceipt|null}
