type Query<T> = (sql: string, values?: unknown[], isSQL92?: boolean) => Promise<T>;

interface ReaderTotals {
    reader: string;
    collection: string;
    count: number;
    repeated: number;
    pending: number;
    elapsedMs: number;
    seen: Set<string>;
}

const MAX_QUERIES = 1000;
const MAX_WINDOW_MS = 60_000;
const readers = new WeakMap<unknown[], string>();
let active: { transactionId?: string; deadline: number; count: number; dropped: number; groups: Map<string, ReaderTotals> } | undefined;

export function beginCheckoutDocumentReads(transactionId?: string): void {
    active = { transactionId, deadline: Date.now() + MAX_WINDOW_MS, count: 0, dropped: 0, groups: new Map() };
}

export function discardCheckoutDocumentReads(): void {
    active = undefined;
}

export function finishCheckoutDocumentReads(transactionId?: string) {
    const window = active;
    if (!window || transactionId !== window.transactionId) return;
    active = undefined;
    if (!window.count) return;
    const groups = [...window.groups.values()]
        .sort((a, b) => b.elapsedMs - a.elapsedMs || b.count - a.count)
        .slice(0, 16)
        .map(({ reader, collection, count, repeated, pending, elapsedMs }) =>
            ({ reader, collection, count, repeated, pending, elapsedMs: Math.round(elapsedMs) }));
    return { count: window.count, dropped: window.dropped, distinctGroups: window.groups.size, groups };
}

function frames(skip: number): string {
    return (new Error().stack || '').split('\n')
        .slice(skip, skip + 6)
        .flatMap(line => {
            const location = line.match(/([\w.-]+\.(?:[cm]?js|tsx?)):(\d+):(\d+)/);
            return location ? [`${location[1]}:${location[2]}:${location[3]}`] : [];
        })
        .join(' > ')
        .slice(0, 160);
}

/** Capture callers before the writer queue drops their synchronous stack. */
export function captureCheckoutDocumentReader(operation: string): string | undefined {
    if (!active || Date.now() > active.deadline) return;
    const caller = frames(4);
    return caller ? `${operation} ${caller}`.slice(0, 160) : operation;
}

export function attributeCheckoutDocumentRead<T extends unknown[]>(values: T, reader?: string): T {
    if (reader) readers.set(values, reader);
    return values;
}

function collectionOf(sql: string, values: unknown[]): string {
    const comparison = /\bcollection_name\s*=\s*(?:'([\w-]+)'|(\?))/i.exec(sql);
    if (!comparison) return 'general';
    const index = (sql.slice(0, comparison.index).match(/\?/g) || []).length;
    const collection = comparison[1] ?? values[index];
    return typeof collection === 'string' && /^[a-z][a-z0-9_-]{0,47}$/i.test(collection) ? collection : 'general';
}

/** Buffers counts and timing only. SQL and bound values stay out of exported diagnostics. */
export function withCheckoutDocumentReadTrace<T>(query: Query<T>): Query<T> {
    return (sql, values, isSQL92) => {
        const window = active;
        if (!window || Date.now() > window.deadline || !/\b(?:FROM|JOIN)\s+(?:"|`|\[)?documents\b/i.test(sql)) {
            return query(sql, values, isSQL92);
        }
        if (window.count >= MAX_QUERIES) {
            window.dropped++;
            return query(sql, values, isSQL92);
        }
        const args = values ?? [];
        const reader = readers.get(args) ?? (frames(3) || 'SQLite directo');
        const collection = collectionOf(sql, args);
        const key = JSON.stringify([reader, collection]);
        let totals = window.groups.get(key);
        if (!totals) {
            totals = { reader, collection, count: 0, repeated: 0, pending: 0, elapsedMs: 0, seen: new Set() };
            window.groups.set(key, totals);
        }
        try {
            const signature = JSON.stringify([sql, args]);
            if (signature.length <= 4096) {
                if (totals.seen.has(signature)) totals.repeated++;
                else totals.seen.add(signature);
            }
        } catch {
            // Counting repeats is optional for non-JSON bindings.
        }
        window.count++;
        totals.count++;
        totals.pending++;
        const start = performance.now();
        const end = () => {
            totals.pending--;
            totals.elapsedMs += performance.now() - start;
        };
        let result: Promise<T>;
        try { result = query(sql, values, isSQL92); }
        catch (error) { end(); throw error; }
        void result.then(end, end);
        return result;
    };
}
