import test from 'node:test';
import assert from 'node:assert/strict';
import { describeV3BaselineChange } from '../services/sync/LargeMasterSyncV3MigrationDiagnostic';

const article = { id: 'P', sku: 'SKU', type: 'PRODUCT', inventoriable: true, measurementUnit: 'UND', purchaseUnit: 'UND', conversionFactor: 1, taxable: true, taxIds: ['TX'], operationalFlags: { trackInventory: true } };

test('semantic evidence ignores price, names and categories, preserving input records',()=>{
 const before=JSON.stringify(article);
 assert.equal(describeV3BaselineChange('articles',[article],[{...article,price:300,name:'Updated',category:'GENERAL'}],1,2),undefined);
 assert.equal(JSON.stringify(article),before);
});

test('semantic evidence names exactly the unit and stock fields rejected by the guard',()=>{
 const change=describeV3BaselineChange('articles',[article],[{...article,purchaseUnit:'LB',operationalFlags:{trackInventory:false}}],1,2)!;
 assert.equal(change.sku,'SKU');
 assert.deepEqual(change.fields,[{field:'purchaseUnit',before:'"UND"',after:'"LB"'},{field:'trackInventory',before:'true',after:'false'}]);
 assert.deepEqual([change.fromVersion,change.toVersion],[1,2]);
});

test('added tariffs and changed variant identities are reported without raw payloads',()=>{
 const tariff=describeV3BaselineChange('tariffs',[],[{id:'T',taxIncluded:false,active:true,secret:'never-copy'}],1,2)!;
 assert.deepEqual(tariff.fields,[{field:'registro',before:'ausente',after:'presente'}]);
 assert.doesNotMatch(JSON.stringify(tariff),/secret|never-copy/);
 const change=describeV3BaselineChange('variants',[{id:'V',sku:'OLD'}],[{id:'V',sku:'NEW'}],1,2)!;
 assert.deepEqual(change.fields,[{field:'sku',before:'"OLD"',after:'"NEW"'}]);
});
