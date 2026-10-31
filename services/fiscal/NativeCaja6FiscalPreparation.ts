import {Capacitor} from '@capacitor/core';
import {db} from '../../utils/db';
import {dbAdapter} from '../db';
import {persistV3FinancialTransaction} from '../sync/LargeMasterSyncV3FinancialCommit';
import {getLargeMasterSyncV3RetainedSession} from '../sync/LargeMasterSyncV3OperationalSession';
import {captureFiscalBoundContext} from './FiscalBoundContext';
import {createCaja6PreparationPolicy} from './Caja6FiscalPreparationPolicy';
import {createSingleFiscalPreparation,type FiscalPreparationController} from './FiscalSinglePreparation';
const requireNative=()=>{if(!Capacitor.isNativePlatform()||Capacitor.getPlatform()!=='android'||!dbAdapter.supportsV3FiscalMetadataCAS||!dbAdapter.getFiscalAppliedSourceRows||!dbAdapter.executeSQL||!dbAdapter.saveDocumentsAtomically)throw Error('FISCAL_NATIVE_CAS_REQUIRED');};
async function sqlRows(query:string,params:any[]=[]):Promise<any[]>{requireNative();const result=await dbAdapter.executeSQL!(query,params);if(!result?.length)return[];const page=result[0];if(!Array.isArray(page.columns)||!Array.isArray(page.values))throw Error('FISCAL_NATIVE_SOURCE_READ_REQUIRED');return page.values.map((values:any[])=>Object.fromEntries(page.columns.map((name:string,index:number)=>[name,values[index]])));}
/** No future command/execution port exists in this production composition. Default dispatch/schedulers remain HOLD. */
export function createNativeCaja6FiscalPreparation():FiscalPreparationController {
 return createSingleFiscalPreparation({context:()=>{requireNative();return captureFiscalBoundContext();},get:(collection,id)=>db.getDocument(collection as any,id),
  // Only the binding is consumed here; never negotiate a master while preparing a committed document.
  catalog:async()=>{requireNative();const session=await getLargeMasterSyncV3RetainedSession();await session.assertCurrent();return{...session.ready.runtime.version,binding:session.binding};},
  outboxRows:async id=>{requireNative();return dbAdapter.getFiscalAppliedSourceRows!(id);},
  fence:async()=>Number((await sqlRows('SELECT COALESCE(MAX(local_sequence),0) AS sequence FROM sync_outbox_v2'))[0]?.sequence||0),
  sourceSequences:id=>sqlRows('SELECT event_id,local_sequence FROM sync_outbox_v2 WHERE aggregate_id=? ORDER BY local_sequence LIMIT 4',[id]),
  commit:async mutations=>{requireNative();await dbAdapter.saveDocumentsAtomically!(mutations);},fetchImpl:(input,init)=>fetch(input,init),
  commitTransaction:persistV3FinancialTransaction,
 },createCaja6PreparationPolicy());
}
