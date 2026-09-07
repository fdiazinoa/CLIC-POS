// Read-only capture and transpilation. Never loads operational modules.
const fs=require('fs'),cp=require('child_process'),crypto=require('crypto'),ts=require('typescript');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const paths=['services/sync/sourceIdentity.ts','services/sync/erpOutboundPayloads.ts','services/sync/customerIdentityContract.ts','utils/paymentSettlement.ts','utils/creditRules.ts','utils/zReportPaymentSummary.ts','utils/analytics.ts','utils/orderServiceType.ts'];
const modules=Object.fromEntries(paths.map(p=>{const source=fs.readFileSync(p,'utf8');return [p,{source,sha256:sha(source),compiled:compile(source)}]}));
const app=fs.readFileSync('App.tsx','utf8'),dash=fs.readFileSync('components/ZReportDashboard.tsx','utf8');
function fragment(path,s,start,end,offset=0){const a=s.indexOf(start,offset),b=s.indexOf(end,a);if(a<0||b<=a)throw Error(start);return {path,sourceSha256:sha(s),startLine:s.slice(0,a).split('\n').length,source:s.slice(a,b)};}
const close=app.indexOf('  const handleZReport =');
const fragments={
 pending:fragment('App.tsx',app,'  const normalizeTerminalId =','  const belongsToCurrentCashier'),
 selection:fragment('App.tsx',app,'      const terminalTransactions =','      console.log(`🔒',close),
 closePreparation:fragment('App.tsx',app,'      // 3. Totals','      // 4. Create and Save Z-Report',close),
 zObject:fragment('App.tsx',app,'      const newZReport:','      console.log("💾 Saving',close),
 declaration:fragment('components/ZReportDashboard.tsx',dash,'   // Identificar terminal activa','   const cashMovementDetails'),
 confirm:fragment('components/ZReportDashboard.tsx',dash,'               terminalId: currentTerminalId,','            Promise.resolve(onConfirmClose'),
 resolvers:fragment('components/ZReportDashboard.tsx',dash,'   const configuredDeclarationIds','   const handleRepeatReportFromHistory'),
};
fragments.selection.compiled=compile(fragments.selection.source+'\nresult={terminalTransactions,terminalCashMovements,terminalCollections};');
fragments.pending.compiled=compile(fragments.pending.source+'\nresult={getPendingTransactionsForTerminal,getPendingCashMovementsForTerminal};');
const staticPaths=['utils/closeReportOptions.ts','utils/closeReceiptSummary.ts','services/printer/templates/ZReportReceipt.ts'];
const staticSources=Object.fromEntries(staticPaths.map(p=>{const source=fs.readFileSync(p,'utf8');return [p,{source,sha256:sha(source)}]}));
fragments.dashboardProducer=fragment('components/ZReportDashboard.tsx',dash,'const DENOMINATIONS_BY_CURRENCY','   const handleRepeatReportFromHistory');
const output={staticSources,sourceCommit:cp.execSync('git rev-parse HEAD').toString().trim(),typescript:ts.version,modules,fragments};
process.stdout.write(JSON.stringify(output,null,2)+'\n');
