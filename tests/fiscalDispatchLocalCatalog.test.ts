import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

/**
 * La emisión fiscal de un documento YA emitido sólo consume el `binding` del catálogo. Si en ese
 * punto se negocia un maestro, una caja cuyo baseline no se puede aplicar bloquea el sellado de una
 * nota de crédito que ya existe. Estos guardas fijan que el despacho lea el runtime local y nunca
 * descargue ni aplique catálogo.
 */

test('the fiscal dispatcher never negotiates a master', () => {
  const dispatch = source('services/fiscal/FiscalMSellerDispatch.ts');
  assert.match(dispatch, /import \{getLargeMasterSyncV3RetainedSession\} from '\.\.\/sync\/LargeMasterSyncV3OperationalSession';/);
  assert.doesNotMatch(dispatch, /getLargeMasterSyncV3OperationalSession/);
  assert.match(dispatch, /catalog:async\(\)=>\{const session=await getLargeMasterSyncV3RetainedSession\(\);/);
});

test('the native preparation reads the same local catalog', () => {
  const native = source('services/fiscal/NativeCaja6FiscalPreparation.ts');
  assert.match(native, /import \{getLargeMasterSyncV3RetainedSession\} from '\.\.\/sync\/LargeMasterSyncV3OperationalSession';/);
  assert.doesNotMatch(native, /getLargeMasterSyncV3OperationalSession/);
  assert.match(native, /catalog:async\(\)=>\{requireNative\(\);const session=await getLargeMasterSyncV3RetainedSession\(\);/);
});

test('every consumer of that catalog only reads the binding', () => {
  // El contrato que hace segura la sesión local: `binding` es identidad de vinculación, no versión
  // de maestro, y es lo único que se compara.
  const dispatch = source('services/fiscal/FiscalMSellerDispatch.ts');
  assert.match(dispatch, /catalog:\(\)=>Promise<\{syncId:string;syncVersion:number;binding:string\}>;/);
  assert.match(dispatch, /if\(catalog\.binding!==tx\.v3Binding\)throw Error\('FISCAL_V3_BINDING_MISMATCH'\);/);
  assert.match(dispatch, /if\(\(await deps\.catalog\(\)\)\.binding!==tx\.v3Binding\)throw unknown\(\);/);
  // La preparación compara contra el binding capturado, nunca contra la versión del maestro.
  assert.match(source('services/fiscal/FiscalSinglePreparation.ts'), /catalog\.binding!==selected\.captured\.binding/);
  assert.match(source('services/fiscal/FiscalAppliedReceiptV2.ts'), /catalog:\(\)=>Promise<\{binding:string\}>;/);
});

test('the fiscal metadata guard only requires the binding of the stamped catalog', () => {
  const guard = source('services/db/LargeMasterSyncV3FiscalMetadata.ts');
  assert.match(guard, /previous\.v3Binding !== mutation\.v3CurrentCatalog!\.binding/);
  // Si algún día el guard pasa a exigir versión de maestro, esta ruta deja de ser válida y el test cae.
  assert.doesNotMatch(guard, /v3CurrentCatalog!\.syncVersion/);
});
