import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';

const source=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('production App/Settings remove preparation panel and prospective controller composition',()=>{
 const app=source('App.tsx'),settings=source('components/Settings.tsx');
 assert.equal(/FiscalPreparationPanel|fiscalPreparation=|fiscalSinglePreparation|createNativeCaja6FiscalPreparation|CAJA6_FISCAL_SCOPE/.test(app),false,'App must not compose preparation UI/controller');
 assert.doesNotMatch(settings,/fiscalPreparation|Preparar una operación de prueba|Marcar la próxima venta nueva/);
 assert.equal(existsSync(new URL('../components/FiscalPreparationPanel.tsx',import.meta.url)),false);
 assert.match(app,/import \{ persistV3FinancialTransaction, validateV3FrozenFiscalAmounts,readV3CompletedReservation \}/);
 assert.match(app,/result = await persistV3FinancialTransaction\(/);
});
test('removing preparation preserves separate auth identity and strict tax-service ISSUE holds',()=>{
 assert.match(source('services/sync/Caja6BoundSessionAuth.ts'),/CAJA6_FISCAL_SCOPE/);
 assert.match(source('services/fiscal/FiscalMSellerDispatch.ts'),/TAX_SERVICE_APPLIED_PROFILE/);
 assert.match(source('services/db/LargeMasterSyncV3FiscalMetadata.ts'),/TAX_SERVICE_APPLIED_PROFILE/);
 assert.match(source('services/db/LargeMasterSyncV3FiscalMetadata.ts'),/verifyRejectedFiscalStatusProof/);
});
