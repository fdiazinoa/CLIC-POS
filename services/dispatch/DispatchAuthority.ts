import {canonicalDispatchJSON} from '../db/CompanyDispatchEscrowStore';
export type DispatchScope={tenantId:string;companyId:string;storeId:string;warehouseId:string;localId:string;terminalId:string;deviceId:string;bindingId:string;generation:string};
export type DispatchQuotaAuthority={contractVersion:1;kind:'COMPANY_DISPATCH_QUOTA';id:string;scope:DispatchScope;itemId:string;dimensions:Record<string,unknown>;grantedMinor:number;policyRevision:number;issuedSequence:number;inventoryEffectsContract:'WAREHOUSE_RESERVATION_V1';trackingClockSource?:{schemaVersion:1;source:'DISPATCH_TRACKING_CLOCK_SOURCE_V1';issuedAt:string;receivedAt:string;businessTimezone:string;expiresOn:string|null};catalogSource:{schemaVersion:1;discriminator:'COMPANY_DISPATCH_CATALOG_SOURCE_V1';stockItem:Record<string,unknown>;commercialItem:Record<string,unknown>;tariffs:Record<string,unknown>[];taxes:Record<string,unknown>[]}};
export type DispatchQuotaDelivery=DispatchQuotaAuthority&{authorityHash:string;authorityCanonical:string;digestVersion:'DISPATCH_JSONB_CANONICAL_UTF8_V1'};
const fail=(code:string):never=>{throw Error(code);};
/** Byte provenance verifier, not an unauthenticated grant endpoint. The caller must
 * obtain this envelope from the authenticated bound-terminal delivery transport.
 * We hash retained server bytes, never JSON.stringify a PostgreSQL numeric value. */
export async function verifyDispatchQuotaDelivery(delivery:DispatchQuotaDelivery,expected:DispatchScope):Promise<DispatchQuotaAuthority>{
 if(delivery.digestVersion!=='DISPATCH_JSONB_CANONICAL_UTF8_V1'||typeof delivery.authorityCanonical!=='string'||new TextEncoder().encode(delivery.authorityCanonical).byteLength>2097152||!/^[a-f0-9]{64}$/.test(delivery.authorityHash))fail('DISPATCH_DELIVERY_DIGEST_INVALID');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(delivery.authorityCanonical))),x=>x.toString(16).padStart(2,'0')).join('');
 if(hash!==delivery.authorityHash)fail('DISPATCH_DELIVERY_HASH_MISMATCH');
 const authority=JSON.parse(delivery.authorityCanonical) as DispatchQuotaAuthority;
 const {authorityHash:ignoredHash,authorityCanonical:ignoredCanonical,digestVersion:ignoredVersion,...semantic}=delivery;
 void ignoredHash;void ignoredCanonical;void ignoredVersion;
 if(canonicalDispatchJSON(authority)!==canonicalDispatchJSON(semantic))fail('DISPATCH_DELIVERY_SEMANTIC_MISMATCH');
 if(authority.contractVersion!==1||authority.kind!=='COMPANY_DISPATCH_QUOTA'||authority.inventoryEffectsContract!=='WAREHOUSE_RESERVATION_V1'||!authority.id||!Number.isSafeInteger(authority.grantedMinor)||authority.grantedMinor<=0||!Number.isSafeInteger(authority.policyRevision)||authority.policyRevision<1||!Number.isSafeInteger(authority.issuedSequence)||authority.issuedSequence<1)fail('DISPATCH_DELIVERY_CONTRACT_INVALID');
 if(canonicalDispatchJSON(authority.scope)!==canonicalDispatchJSON(expected))fail('DISPATCH_DELIVERY_BINDING_SCOPE');
 const catalog=authority.catalogSource;
 if(catalog?.schemaVersion!==1||catalog.discriminator!=='COMPANY_DISPATCH_CATALOG_SOURCE_V1'||catalog.stockItem?.id!==authority.itemId||catalog.stockItem.tenant_id!==expected.tenantId||catalog.stockItem.company_id!==expected.companyId||catalog.commercialItem?.tenant_id!==expected.tenantId||catalog.commercialItem.company_id!==expected.companyId||!Array.isArray(catalog.tariffs)||!Array.isArray(catalog.taxes))fail('DISPATCH_DELIVERY_CATALOG_SCOPE');
 return authority;
}
