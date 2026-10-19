import type { User } from '../../types';
import type { DatabaseAdapter } from '../db/DatabaseAdapter';
import { createUuid } from '../../utils/uuid';
import { selectPosUsersForRuntime } from '../../utils/posUserReconciliation';
export const ATTENDANCE_COLLECTION = 'attendanceTimeRecordsV1';
export type AttendanceScope = {
    mode: 'LOCAL_ONLY';
    localTerminalId: string;
    deviceId: string;
} | {
    mode: 'ERP_REGISTER';
    localTerminalId: string;
    deviceId: string;
    tenantId: string;
    companyId: string;
    storeId: string;
    terminalId: string;
};
export interface LocalAttendanceRecord {
    schemaVersion: 1;
    storageKind: 'LOCAL_ONLY';
    id: string;
    operationId: string;
    userId: string;
    userName: string;
    type: 'IN' | 'OUT';
    timestamp: string;
    method: 'PIN';
    scope: AttendanceScope;
}
type AttendanceAdapter = Pick<DatabaseAdapter, 'getCollection' | 'getDocument' | 'saveDocument'>;
function need(value: unknown, message: string): asserts value {
    if (!value) throw Error(message);
}
const text = (value: unknown): value is string => typeof value === 'string' && value.trim() === value && value.length > 0;
function scopeValue(input: unknown): AttendanceScope {
    const value = input as Record<string, unknown>;
    need(value && typeof value === 'object' && !Array.isArray(value), 'ATTENDANCE_SCOPE_REQUIRED');
    const keys = value.mode === 'LOCAL_ONLY' ? ['mode', 'localTerminalId', 'deviceId'] : ['mode', 'localTerminalId', 'deviceId', 'tenantId', 'companyId', 'storeId', 'terminalId'];
    need((value.mode === 'LOCAL_ONLY' || value.mode === 'ERP_REGISTER') && Object.keys(value).length === keys.length && keys.every(key => text(value[key])), 'ATTENDANCE_SCOPE_REQUIRED');
    return Object.fromEntries(keys.map(key => [key, value[key]])) as AttendanceScope;
}
export const attendanceScopeKey = (scope: AttendanceScope) => JSON.stringify(scopeValue(scope));
export function resolveAttendanceScope(terminal: {
    id: string;
    config?: {
        currentDeviceId?: string;
        erpTerminalId?: string;
        erpBinding?: {
            tenantId?: string;
            companyId?: string;
            storeId?: string;
            terminalId?: string;
            deviceId?: string;
        };
    };
} | undefined, deviceId: string, erpManaged?: boolean): AttendanceScope | null {
    if (!terminal || !text(terminal.id) || !text(deviceId) || terminal.config?.currentDeviceId && terminal.config.currentDeviceId !== deviceId)
        return null;
    const base = { localTerminalId: terminal.id, deviceId }, binding = terminal.config?.erpBinding;
    if (binding?.deviceId && binding.deviceId !== deviceId)
        return null;
    if (erpManaged === false)
        return { mode: 'LOCAL_ONLY', ...base };
    if (!binding)
        return erpManaged || terminal.config?.erpTerminalId ? null : { mode: 'LOCAL_ONLY', ...base };
    try {
        const scope = scopeValue({ mode: 'ERP_REGISTER', ...base, tenantId: binding.tenantId, companyId: binding.companyId, storeId: binding.storeId, terminalId: binding.terminalId });
        if (terminal.config?.erpTerminalId && terminal.config.erpTerminalId !== binding.terminalId)
            return null;
        return scope;
    }
    catch {
        return null;
    }
}
export function authenticateAttendancePin(users: User[], pin: string, erpManaged: boolean): User {
    const matches = selectPosUsersForRuntime(users, { erpManaged }).filter(user => user.id && /^\d{4}$/.test(pin) && user.pin === pin);
    need(matches.length === 1, 'PIN incorrecto, inactivo o ambiguo.');
    return matches[0];
}
export function validateAttendanceRecord(input: unknown): LocalAttendanceRecord {
    const value = input as Record<string, unknown>;
    need(value && typeof value === 'object' && !Array.isArray(value), 'ATTENDANCE_RECORD_INVALID');
    const keys = ['schemaVersion', 'storageKind', 'id', 'operationId', 'userId', 'userName', 'type', 'timestamp', 'method', 'scope'];
    need(Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key)) && value.schemaVersion === 1 && value.storageKind === 'LOCAL_ONLY' && value.method === 'PIN' && text(value.id) && value.id === value.operationId && text(value.userId) && text(value.userName) && (value.type === 'IN' || value.type === 'OUT') && text(value.timestamp) && Number.isFinite(Date.parse(value.timestamp)) && new Date(value.timestamp).toISOString() === value.timestamp, 'ATTENDANCE_RECORD_INVALID');
    return { schemaVersion: 1, storageKind: 'LOCAL_ONLY', id: value.id, operationId: value.operationId, userId: value.userId, userName: value.userName, type: value.type, timestamp: value.timestamp, method: 'PIN', scope: scopeValue(value.scope) };
}
export function createAttendanceOperation(scope: AttendanceScope, user: User, type: 'IN' | 'OUT', identity: {
    id?: string;
    timestamp?: string;
} = {}): LocalAttendanceRecord {
    const id = identity.id ?? createUuid();
    return validateAttendanceRecord({ schemaVersion: 1, storageKind: 'LOCAL_ONLY', id, operationId: id, userId: user.id, userName: user.name, type, timestamp: identity.timestamp ?? new Date().toISOString(), method: 'PIN', scope });
}
const queues = new WeakMap<object, Promise<unknown>>();
export function createLocalAttendanceRepository(adapter: AttendanceAdapter) {
    const readyScopes = new Set<string>();
    async function load(scope: AttendanceScope) {
        const key = attendanceScopeKey(scope);
        readyScopes.delete(key);
        const rows = await adapter.getCollection<unknown>(ATTENDANCE_COLLECTION);
        need(Array.isArray(rows), 'ATTENDANCE_STORAGE_UNREADABLE');
        const unique = new Map<string, LocalAttendanceRecord>();
        for (const raw of rows) {
            const row = validateAttendanceRecord(raw), prior = unique.get(row.id);
            need(!prior || JSON.stringify(prior) === JSON.stringify(row), 'ATTENDANCE_RECORD_CONFLICT');
            unique.set(row.id, row);
        }
        readyScopes.add(key);
        return [...unique.values()].filter(row => attendanceScopeKey(row.scope) === key).sort((a, b) => b.timestamp.localeCompare(a.timestamp) || a.id.localeCompare(b.id));
    }
    function commit(input: LocalAttendanceRecord) {
        const record = validateAttendanceRecord(input), serialized = JSON.stringify(record);
        const operation = (queues.get(adapter) || Promise.resolve()).catch(() => { }).then(async () => {
            // Validate retained history once per scope; subsequent writes touch only their immutable ID.
            if (!readyScopes.has(attendanceScopeKey(record.scope))) await load(record.scope);
            const existing = await adapter.getDocument(ATTENDANCE_COLLECTION, record.id);
            if (existing)
                need(JSON.stringify(validateAttendanceRecord(existing)) === serialized, 'ATTENDANCE_RECORD_CONFLICT');
            else
                await adapter.saveDocument(ATTENDANCE_COLLECTION, record);
            const persisted = await adapter.getDocument(ATTENDANCE_COLLECTION, record.id);
            need(persisted && JSON.stringify(validateAttendanceRecord(persisted)) === serialized, 'ATTENDANCE_READBACK_REQUIRED');
            return validateAttendanceRecord(persisted);
        });
        queues.set(adapter, operation);
        return operation;
    }
    return { load, commit };
}
