import { db } from '../../utils/db';
import type { BusinessConfig } from '../../types';
import { getLargeMasterSyncV3OperationalSession } from './LargeMasterSyncV3OperationalSession';
import { LargeMasterSyncV3Error } from './LargeMasterSyncV3Types';
import { dbAdapter } from '../db';
import { acquireLargeMasterSyncV3ConfigContext } from './LargeMasterSyncV3OperationalSession';
import type { V3ConfigRefreshAuthority } from './LargeMasterSyncV3ConfigRefreshAuthority';

/** The shared session owns native staging, manifests, chunks, inventory and owner readback. */
export const persistLargeMasterSyncV3ConfigPushCatalog = async (assertBinding: () => void,
  authority: V3ConfigRefreshAuthority): Promise<void> => {
  let persisting = false;
  try {
    assertBinding();
    const committed = await db.get('config') as unknown as BusinessConfig;
    authority.assertCurrent(committed);
    await acquireLargeMasterSyncV3ConfigContext(committed, authority.localTerminalId);
    authority.assertCurrent(await db.get('config') as unknown as BusinessConfig);
    const session = await getLargeMasterSyncV3OperationalSession(true);
    assertBinding();
    await session.assertCurrent();
    persisting = true;
    const config = await db.get('config') as unknown as BusinessConfig;
    authority.assertCurrent(config);
    const projected = await session.projectConfig(config);
    assertBinding();
    if (!dbAdapter.compareAndSwapV3SetupConfig) throw new LargeMasterSyncV3Error('SYNC_V3_NATIVE_STORE_UNAVAILABLE');
    await dbAdapter.compareAndSwapV3SetupConfig(config, projected, () => {
      authority.assertCurrent(config);
      session.assertSetupIdentity();
    });
    const saved = await db.get('config') as unknown as BusinessConfig;
    authority.assertCurrent(saved);
    if (JSON.stringify([saved.tariffs, saved.taxes, saved.taxRate]) !==
      JSON.stringify([projected.tariffs, projected.taxes, projected.taxRate])) {
      throw new LargeMasterSyncV3Error('SYNC_V3_CONFIG_READBACK_FAILED', undefined, true);
    }
    await session.assertCurrent();
    assertBinding();
  } catch (error) {
    const code = String((error as { code?: string })?.code || (error as Error)?.message || '');
    if (/BINDING|CONTEXT|AUTH|TOKEN|TENANT|TERMINAL|TAX_INVALID|TARIFF_UNAVAILABLE/.test(code)) throw error;
    if (!persisting && (error as {code?:string})?.code && ![
      'SYNC_V3_INVENTORY_NOT_READY', 'SYNC_V3_RUNTIME_VERSION_CHANGED',
    ].includes(code)) throw error;
    // Native activation may already be durable: retain the outbox checkpoint for resumable retry.
    throw new LargeMasterSyncV3Error(code || 'SYNC_V3_CONFIG_PERSISTENCE_FAILED', undefined, true);
  }
};
