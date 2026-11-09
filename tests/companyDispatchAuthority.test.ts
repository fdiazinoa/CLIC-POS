import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyDispatchQuotaDelivery,type DispatchQuotaDelivery} from '../services/dispatch/DispatchAuthority';
// Golden generated from the real ERP PostgreSQL17 issueQuota RPC, synthetic IDs only.
// Source includes PostgreSQL numeric 6.0000 and non-ASCII text deliberately.
const golden=JSON.parse(readFileSync(new URL('./fixtures/companyDispatchQuota.pg.json',import.meta.url),'utf8')) as DispatchQuotaDelivery;
test('real PostgreSQL canonical UTF8 bytes verify without JS reserialization of numeric/Unicode source',async()=>{const authority=await verifyDispatchQuotaDelivery(golden,golden.scope);assert.equal(authority.catalogSource.commercialItem.nombre,'Sintético ñ / café 😀');assert.match(golden.authorityCanonical,/"factor":6/);assert.equal(authority.grantedMinor,8000000);});
test('tampered bytes, semantic envelope or rebound scope cannot become an installed authority',async()=>{await assert.rejects(verifyDispatchQuotaDelivery({...golden,authorityCanonical:golden.authorityCanonical.replace('"factor":6','"factor":8')},golden.scope),/HASH_MISMATCH/);await assert.rejects(verifyDispatchQuotaDelivery({...golden,grantedMinor:9000000},golden.scope),/SEMANTIC_MISMATCH/);await assert.rejects(verifyDispatchQuotaDelivery(golden,{...golden.scope,generation:'other-generation'}),/BINDING_SCOPE/);});
