
import { DatabaseAdapter } from './DatabaseAdapter';
import { LocalStorageAdapter } from './adapters/LocalStorageAdapter';
import { SQLiteWASMAdapter } from './adapters/SQLiteWASMAdapter';
import { NetworkAdapter } from './adapters/NetworkAdapter';

// Factory to get the correct adapter based on environment
const getAdapter = (): DatabaseAdapter => {
    // In the future, check for Electron or Capacitor here
    // return new SQLiteWASMAdapter(); // Uncomment to test SQLite Adapter
    // return new LocalStorageAdapter();
    return new NetworkAdapter();
};

export const dbAdapter = getAdapter();

export const initDatabase = async () => {
    await dbAdapter.connect();
};
