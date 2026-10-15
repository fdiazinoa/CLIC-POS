import type { DatabaseAdapter } from './DatabaseAdapter';

/** Reloading the WebView cannot cancel a native SQLite migration. */
export async function retryDatabaseStartup(
    adapter: Pick<DatabaseAdapter, 'disconnect'>,
    reload: () => void,
): Promise<void> {
    await adapter.disconnect();
    reload();
}
