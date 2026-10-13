import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPosCategoryIdentity } from '../utils/posCategoryIdentity';
import { applyTerminalConfigSnapshot } from '../utils/terminalConfigSnapshot';
import { getInitialConfig } from '../constants';
const id = '8af264ba-6951-44f9-a027-c5b845851868';
test('renamed category preserves UUID/code through snapshot and persisted reload; stable product identity wins', () => {
 const base = getInitialConfig('Restaurante' as any);
 const terminalId = base.terminals[0].id;
 const snapshot = { resolved: { catalog: { allowed_categories: [{ id, code: 'TD-01', name: 'Todos1', color: '#123456' }] } } };
 const result = applyTerminalConfigSnapshot(base, { terminalId, incomingSnapshot: snapshot as any }).config;
 assert.deepEqual(result.posCategories?.map(c=>[c.id,c.code,c.name]), [[id,'TD-01','Todos1']]);
 const reloaded = JSON.parse(JSON.stringify(result));
 const twice = applyTerminalConfigSnapshot(reloaded, { terminalId, incomingSnapshot: snapshot as any }).config;
 assert.equal(twice.posCategories?.[0].id,id);
 const lookup = buildPosCategoryIdentity(twice.posCategories || []);
 assert.equal(lookup.productCategory({posCategoryId:id,category:'Todos'}), id);
 assert.equal(lookup.canonicalize('Todos1'),id);
 assert.equal(lookup.canonicalize('TD-01'),id);
 assert.equal(lookup.canonicalToCategory.get(id)?.name,'Todos1');
 assert.notEqual(lookup.productCategory({posCategoryId:'foreign',category:'Todos1'}),id);
 assert.equal(lookup.productCategory({category:'Todos1'}),id);
});
test('colliding names/codes never merge explicit identities; unrelated families cannot hijack category ID',()=>{
 const lookup=buildPosCategoryIdentity([{id:'a',name:'Same',code:'X'},{id:'b',name:'Same',code:'X'}], [{id:'family',name:'a'}]);
 assert.equal(lookup.productCategory({posCategoryId:'a',category:'Same'}),'a');
 assert.equal(lookup.productCategory({posCategoryId:'b',category:'Same'}),'b');
 assert.notEqual(lookup.canonicalize('Same'),'a');
 assert.notEqual(lookup.canonicalize('X'),'b');
 assert.equal(lookup.canonicalize('a'),'a');
 assert.notEqual(lookup.productCategory({posCategoryId:'foreign',category:'Same'}),'a');
});

test('family names cannot shadow authoritative POS category aliases',()=>{ const x=buildPosCategoryIdentity([{id:'pos',name:'Todos1',code:'TD-01'}],[{id:'family',name:'Todos1',code:'TD-01'}]); assert.equal(x.canonicalize('Todos1'),'pos'); assert.equal(x.canonicalize('TD-01'),'pos'); });
