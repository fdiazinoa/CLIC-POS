import type {Transaction} from '../../types';
export interface FiscalWorkflowScope {tenantId:string;companyId:string;storeId:string;terminalId:string;deviceId:string}
export interface FiscalWorkflowPermitV2 {schemaVersion:2;permitId:string;transactionId:string;nonce:string;createdAt:string;expiresAt:string;scope:FiscalWorkflowScope;issuerRnc:string;environment:0|1|2;authorityHash:string;operationKind:'SALE'|'RETURN'|'VOID';originalReference?:{documentId:string;transactionId:string;ncf:string;issuerRnc:string;environment:0|1|2;sourceChecksum:string};state?:string}
export interface FiscalWorkflowBirthV2 {schemaVersion:2;permitId:string;transactionId:string;nonce:string;checkoutId:string}
export interface FiscalWorkflowCheckoutV2 {checkoutId:string;operationId:string;transactionId:string;scopeKey:string;cartIdentity:string;permit:FiscalWorkflowPermitV2|null;phase:'PREPARED'|'EFFECT_POSSIBLE'|'COMMITTED'|'ACKNOWLEDGED';paymentIds:string[]}
export interface FiscalWorkflowStateV2 {schemaVersion:2;source:'ERP_POS_FISCAL_WORKFLOW_V2';sourceKind?:'ORDINARY_SOURCE_V2'|'FORMAT_SOURCE_V2';documentId?:string;documentDate?:string;mode:'WORKFLOW'|'STATUS_ONLY';transactionId:string;workflowId:string|null;permitId:string|null;scope:FiscalWorkflowScope;issuerRnc:string;environment:number;ncf:string;ncfType:string;originalDigestV2:string;checksumV1:string|null;currency:string;exchangeRate:number;total:number;saleEventId:string|null;originalSourceEnvelope:Record<string,any>;state:string;decision:'PENDING'|'ACCEPTED'|'ACCEPTED_CONDITIONAL'|'REJECTED';signature:{schemaVersion:1;qrUrl:string;securityCode:string;signedAt:string}|null;draftRevision:number;buyer:Record<string,string>;projectionDigest:string|null;observationVersion:number;canCorrect:boolean;reason:string|null;history:Array<Record<string,any>>;observedAt:string}
export interface FiscalWorkflowStore {
 refillOperation(scopeKey:string):Promise<string>;
 savePermits(scopeKey:string,operationId:string,permits:FiscalWorkflowPermitV2[]):Promise<void>;
 reserveCheckout(scopeKey:string,cartIdentity:string,selection?:{operationKind:'RETURN'|'VOID';originalReference:NonNullable<FiscalWorkflowPermitV2['originalReference']>},operationId?:string,options?:{requirePermit?:boolean;authorityHash?:string}):Promise<FiscalWorkflowCheckoutV2>;
 markPaymentPossible(checkoutId:string,paymentId:string):Promise<void>;
 acknowledgeCheckout(checkoutId:string):Promise<void>;
 currentCheckout(scopeKey:string):Promise<FiscalWorkflowCheckoutV2|null>;
 readCheckout(checkoutId:string):Promise<FiscalWorkflowCheckoutV2|null>;
 readState(transactionId:string):Promise<FiscalWorkflowStateV2|null>;
 saveState(source:Transaction,state:FiscalWorkflowStateV2,expectedVersion:number|null):Promise<void>;
 candidates(scopeKey:string,afterId:string,limit:number):Promise<string[]>;
}

export const fiscalWorkflowScopeKey=(scope:FiscalWorkflowScope):string=>JSON.stringify(Object.fromEntries(Object.keys(scope).sort().map(key=>[key,(scope as any)[key]])));
