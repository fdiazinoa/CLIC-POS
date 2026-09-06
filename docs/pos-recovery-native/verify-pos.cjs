// Offline comparison only. Executes pure helpers and exact calculation excerpts;
// never loads App, database, printer, sync worker or refund persistence modules.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const bundle = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures.json'), 'utf8'));
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const hashes = {};
const allowed = new Set(['utils/paymentSettlement.ts', 'utils/creditRules.ts', 'utils/analytics.ts']);
const cache = new Map();
const digest = text => crypto.createHash('sha256').update(text).digest('hex');
function load(relative) {
  assert(allowed.has(relative), `Unexpected import: ${relative}`);
  if (cache.has(relative)) return cache.get(relative).exports;
  const source = read(relative);
  hashes[relative] = digest(source);
  const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const module = {exports: {}};
  cache.set(relative, module);
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, {})((name) => {
    const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(relative), `${name}.ts`));
    return load(dependency);
  }, module, module.exports);
  return module.exports;
}
function excerpt(file, startMarker, endMarker, trailer) {
  const source = read(file);
  hashes[file] = digest(source);
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert(start >= 0 && end > start, `Review extraction markers in ${file}`);
  return ts.transpileModule(source.slice(start, end) + trailer, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
}
const dashboard = excerpt('components/ZReportDashboard.tsx', '   const payments = filteredTransactions.flatMap', '   const currenciesRequiringCashCount', '\nresult=expectedCashByCurrency;');
// Find the excerpt only within handleZReport, avoiding the preceding X-report.
const app = read('App.tsx');
const closeStart = app.indexOf('  const handleZReport =');
assert(closeStart >= 0);
const openedStart = app.indexOf('      const openedAtCandidates =', closeStart);
const openedEnd = app.indexOf('      // 4. Create and Save Z-Report', openedStart);
assert(openedStart > closeStart && openedEnd > openedStart);
hashes['App.tsx'] = digest(app);
const openedCode = ts.transpileModule(app.slice(openedStart,openedEnd)+'\nresult=openedAt;', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const helpers = load('utils/paymentSettlement.ts');
const analytics = load('utils/analytics.ts');
class FixedDate extends Date { constructor(...args) {super(...(args.length ? args : [bundle.fixedNow]));} static now(){return new Date(bundle.fixedNow).getTime();} }
const results = bundle.fixtures.map(f => {
  const before = JSON.stringify(f);
  const context = {filteredTransactions:f.transactions,filteredCashMovements:f.cashMovements,baseCurrencyCode:bundle.baseCurrencyCode,...helpers,result:null};
  vm.runInNewContext(dashboard, context);
  const openedContext = {terminalTransactions:f.transactions,terminalCashMovements:f.cashMovements,Date:FixedDate,result:null};
  vm.runInNewContext(openedCode, openedContext);
  const stats = analytics.calculateZReportStats(f.transactions,f.collections);
  const actual = {cashExpected:JSON.parse(JSON.stringify(context.result)),collectionsTotal:stats.collectionsTotal,returnsTotal:stats.returnsTotal,openedAt:openedContext.result};
  assert.deepEqual(actual, f.expected, f.id);
  assert.equal(JSON.stringify(f),before,'Calculation mutated fixture');
  for(const c of f.collections){
    assert.equal(c.allocations.reduce((sum,a)=>sum+a.amount,0),c.appliedAmountBase);
    assert.equal(c.appliedAmountBase+c.unappliedAmountBase,c.receivedAmountBase);
    for(const a of c.allocations){assert.equal(a.collectionId,c.id);assert(f.closedReferences.some(t=>t.id===a.transactionId)||f.transactions.some(t=>t.id===a.transactionId));}
  }
  return {id:f.id,...actual};
});
assert.notEqual(results.find(r=>r.id==='P06_UNVERIFIED_CASH_REFUND_DIAGNOSTIC').cashExpected.DOP,950);
assert.equal(results.find(r=>r.id==='P03_REFUND_STORE_CREDIT').cashExpected.DOP,1000);
console.log(JSON.stringify({status:'PASS',sourceCommit:bundle.sourceCommit,sourceHashes:hashes,results,limitations:['No UI execution, database, HTTP, restoration, Z emission or distributed-protocol tests.','Existing Z shape fixture is schema-only; no physical count is asserted.','Inputs are synthetic and preselected; terminal isolation/selectors are not tested here.']},null,2));
