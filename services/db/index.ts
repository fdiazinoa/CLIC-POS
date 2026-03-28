import { Capacitor } from '@capacitor/core';
import { DatabaseAdapter } from './DatabaseAdapter';
import { CapacitorSQLiteAdapter } from './adapters/CapacitorSQLiteAdapter';
import { IndexedDBAdapter } from './adapters/IndexedDBAdapter';

const isNativeAndroid = (): boolean => {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
};

const getAdapter = (): DatabaseAdapter => {
    if (isNativeAndroid()) {
        console.log('[DB] Using CapacitorSQLiteAdapter for Android native runtime.');
        return new CapacitorSQLiteAdapter();
    }

    console.log('[DB] Using IndexedDBAdapter for web runtime.');
    return new IndexedDBAdapter();
};

export const dbAdapter = getAdapter();

export const initDatabase = async () => {
    await dbAdapter.connect();
};
