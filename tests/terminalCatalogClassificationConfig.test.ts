import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { nativeFixture } from './articleFormatsNativeFixture';
import { mergePosCategoryPresentation } from '../utils/posCatalogPresentation';

const source = ts.createSourceFile('SyncManager.ts',
  readFileSync(new URL('../services/sync/SyncManager.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const manager = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'SyncManager') as ts.ClassDeclaration;
const method = manager.members.find(node => node.name?.getText(source) === 'applyTerminalCatalogClassifications')!;
const code = ts.transpileModule(`class Subject { ${method.getText(source)} }; return Subject;`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

test('an unchanged classification refresh skips the SQLite config replacement, and a real change keeps its atomic write', async () => {
  const fixture = await nativeFixture();
  try {
    const updates: string[] = [];
    const marks: string[] = [];
    const db = {
      get: (collection: string) => fixture.adapter.getCollection(collection),
      save: (collection: string, value: unknown) => fixture.adapter.saveCollection(collection, value as unknown[]),
      saveDocument: (collection: string, value: { id: string }) => fixture.adapter.saveDocument(collection, value),
    };
    const Subject = new Function('db', 'mergePosCategoryPresentation', 'measureSettingsReturnQa',
      'markSettingsReturnQa', 'window', 'CustomEvent', 'posCatalogDebugLog', code)(
      db, mergePosCategoryPresentation, (_: string, work: () => Promise<unknown>) => work(),
      (name: string) => marks.push(name), { dispatchEvent: (event: { type: string }) => updates.push(event.type) },
      class { constructor(public type: string) {} }, () => undefined);
    const subject = new Subject();
    const before = await db.get('config');
    const storedAt = '2025-01-01T00:00:00Z';
    const metadata = { source: 'ERP_TERMINAL_CONFIG', syncSource: 'ERP_SNAPSHOT', updatedAt: storedAt };
    await db.save('config', {
      ...before,
      departments: [{ ...metadata, name: 'Bebidas', code: 'D', id: 'D', isActive: true }],
      posCategories: [{ ...metadata, id: 'POS', code: 'CAT', name: 'Bebidas', color: '#fff', sortOrder: 8, isActive: false }],
    });
    fixture.db.exec(`
      CREATE TABLE config_update_audit (entry INTEGER);
      CREATE TRIGGER config_update_audit AFTER UPDATE ON documents
      WHEN NEW.collection_name='config' BEGIN INSERT INTO config_update_audit VALUES(1); END;
    `);
    const auditCount = () => (fixture.db.prepare('SELECT count(*) AS n FROM config_update_audit').get() as { n: number }).n;
    const snapshot = { catalog: {
      departments: [{ id: 'D', name: 'Bebidas' }],
      categories: [{ id: 'POS', code: 'CAT', name: 'Bebidas', color: '#111', sortOrder: 1 }],
    } };
    await subject.applyTerminalCatalogClassifications(snapshot);
    assert.equal(auditCount(), 0);
    assert.deepEqual(updates, ['categoriesUpdated', 'productGroupsUpdated']);
    assert.deepEqual(marks, ['sync.config.classifications.unchanged']);
    assert.equal((await db.get('config')).departments[0].updatedAt, storedAt);

    const changed = structuredClone(snapshot);
    changed.catalog.departments[0].name = 'Bebidas frías';
    await subject.applyTerminalCatalogClassifications(changed);
    assert.equal(auditCount(), 1);
    const persisted = await db.get('config');
    assert.equal(persisted.departments[0].name, 'Bebidas frías');
    assert.equal(persisted.posCategories[0].updatedAt, storedAt);
    assert.equal(persisted.posCategories[0].color, '#fff');
    assert.deepEqual(persisted.terminals, before.terminals);
    assert.equal(updates.at(-1), 'configUpdated');
    await subject.applyTerminalCatalogClassifications(changed);
    assert.equal(auditCount(), 1);
    assert.equal(updates.filter(event => event === 'configUpdated').length, 1);

    fixture.db.exec(`
      INSERT INTO documents VALUES ('config','old','{"id":"old"}',1,'fixture');
      CREATE TRIGGER reject_invalid_config BEFORE UPDATE ON documents
      WHEN NEW.collection_name='config' AND NEW.doc_id='current'
      BEGIN SELECT RAISE(ABORT,'config validation'); END;
    `);
    changed.catalog.departments[0].name = 'Bebidas calientes';
    await assert.rejects(subject.applyTerminalCatalogClassifications(changed), /config validation/);
    assert.deepEqual(await db.get('config'), persisted);
    assert.equal(fixture.documents('config').length, 2);
    assert.equal(auditCount(), 1);
    assert.equal(updates.filter(event => event === 'configUpdated').length, 1);
  } finally {
    fixture.db.close();
  }
});

test('native config replacement skips identical bytes while preserving omission and fiscal revocation', async () => {
  const fixture = await nativeFixture();
  try {
    const config = await fixture.adapter.getCollection('config');
    const storedConfig = () => fixture.db.prepare(
      "SELECT data,updatedAt FROM documents WHERE collection_name='config' AND doc_id='current'",
    ).get() as { data: string; updatedAt: string };
    fixture.db.exec(`
      CREATE TABLE config_update_audit (entry INTEGER);
      CREATE TRIGGER config_update_audit AFTER UPDATE ON documents
      WHEN NEW.collection_name='config' AND NEW.doc_id='current' BEGIN INSERT INTO config_update_audit VALUES(1); END;
    `);
    const auditCount = () => (fixture.db.prepare('SELECT count(*) AS n FROM config_update_audit').get() as { n: number }).n;
    const original = storedConfig();
    await fixture.adapter.saveCollection('config', config);
    assert.deepEqual(storedConfig(), original);
    assert.equal(auditCount(), 0);

    fixture.db.exec(`INSERT INTO documents VALUES ('config','old','{"id":"old"}',1,'fixture');`);
    await fixture.adapter.saveCollection('config', config);
    assert.deepEqual(storedConfig(), original);
    assert.deepEqual(fixture.documents('config').map(row => row.id), ['current']);
    assert.equal(auditCount(), 0);

    fixture.db.prepare(`INSERT INTO pos_offline_fiscal_allocations_v2
      (authorization_id,scope_key,authority_json,binding_hash,server_offset_ms,max_local_ms,revoked)
      VALUES ('authority','scope',?,'hash',0,0,0)`).run(JSON.stringify({ issuerRnc: '999999999' }));
    await fixture.adapter.saveCollection('config', config);
    assert.deepEqual(fixture.db.prepare("SELECT revoked FROM pos_offline_fiscal_allocations_v2 WHERE authorization_id='authority'").get(), { revoked: 1 });
    assert.equal(auditCount(), 1, 'identical config still fires its revocation validation when necessary');

    await fixture.adapter.saveCollection('config', { ...config, companyInfo: { rnc: '101010101' } });
    assert.equal(JSON.parse(storedConfig().data).companyInfo.rnc, '101010101');
    assert.equal(auditCount(), 2);
  } finally {
    fixture.db.close();
  }
});
