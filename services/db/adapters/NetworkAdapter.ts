import { DatabaseAdapter } from '../DatabaseAdapter';

export class NetworkAdapter implements DatabaseAdapter {
    private baseUrl: string | null = null;

    constructor() {
        console.log("🌐 NetworkAdapter instantiated.");
        this.initializeBaseUrl();
    }

    private initializeBaseUrl() {
        // Check if we are explicitly in Slave mode (via localStorage flag from Binding Screen)
        const masterIp = localStorage.getItem('pos_master_ip');
        const protocol = window.location.protocol.replace(':', ''); // http or https
        const port = '3000'; // Assuming master runs frontend on 3000 which proxies to 3001

        if (masterIp) {
            // Use configured Master IP
            // We use the frontend port (3000) because of the proxy setup in vite.config.ts
            // If we hit 3001 directly from browser, we might hit CORS issues if not configured
            // But NetworkAdapter usually hits /api. 
            // If we are slave, we want to hit the Master's IP.
            // The Master's frontend (Vite) proxies /api to its local backend.
            this.baseUrl = `${protocol}://${masterIp}:${port}/api`;
            console.log(`🔒 NetworkAdapter configured for SLAVE mode. Master: ${this.baseUrl}`);
        } else {
            // Master/Local Mode
            this.baseUrl = '/api';
            console.log(`🔗 NetworkAdapter configured for LOCAL mode. Base: ${this.baseUrl}`);
        }
    }


    private getUrl(path: string): string {
        if (!this.baseUrl) {
            this.initializeBaseUrl();
        }

        // Avoid double slashes
        const base = this.baseUrl!.endsWith('/') ? this.baseUrl!.slice(0, -1) : this.baseUrl;
        const cleanPath = path.startsWith('/') ? path.slice(1) : path;
        const finalUrl = `${base}/${cleanPath}`;

        // SANITY CHECK
        console.log('Target URL:', finalUrl);
        if (finalUrl.includes('undefined')) {
            console.error('❌ CRITICAL: IP DEL MAESTRO NO CARGADA');
            // Throw a controlled error that App.tsx can catch to show configuration modal
            throw new Error('NETWORK_CONFIG_MISSING');
        }

        return finalUrl;
    }

    async checkHealth(): Promise<boolean> {
        try {
            const url = this.getUrl('status');
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout

            const res = await fetch(url, {
                mode: 'cors',
                headers: { 'Connection': 'keep-alive' },
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (res.ok) {
                const data = await res.json();
                return data.status === 'ok';
            }
            return false;
        } catch (error) {
            console.error('Healthcheck failed:', error);
            return false;
        }
    }

    async connect(): Promise<void> {
        // Check connectivity via proxy
        try {
            const url = this.getUrl('config');
            const res = await fetch(url, {
                mode: 'cors',
                headers: { 'Connection': 'keep-alive' }
            }); // Use a known endpoint
            if (!res.ok && res.status !== 404) throw new Error('Server not reachable');
            console.log("✅ Connected to CLIC-POS Backend.");
        } catch (error) {
            console.error("❌ Failed to connect to backend:", error);
            // We might want to throw here or fallback to offline mode in future
        }
    }

    async disconnect(): Promise<void> {
        // No persistent connection to close
    }

    async getCollection<T>(collectionName: string): Promise<T[]> {
        if (!collectionName) {
            console.warn('⚠️ NetworkAdapter: getCollection called with undefined collectionName');
            return [];
        }

        const url = this.getUrl(collectionName);
        console.log(`📡 Fetching collection: ${url}`);

        if (url.includes('undefined')) {
            console.error(`🛑 Aborting request to invalid URL: ${url}`);
            window.dispatchEvent(new CustomEvent('network-config-required'));
            return [];
        }

        try {
            const res = await fetch(url, {
                mode: 'cors',
                headers: { 'Connection': 'keep-alive' }
            });
            if (!res.ok) {
                if (res.status === 404) return [];
                throw new Error(`Failed to fetch ${collectionName}: ${res.statusText}`);
            }
            return await res.json();
        } catch (error) {
            console.error(`Error fetching collection ${collectionName} from ${url}:`, error);
            return [];
        }
    }

    async saveCollection<T>(collectionName: string, data: T[]): Promise<void> {
        if (!collectionName) {
            console.warn('⚠️ NetworkAdapter: saveCollection called with undefined collectionName');
            return;
        }

        const url = this.getUrl(collectionName);

        if (url.includes('undefined')) {
            console.error(`🛑 Aborting save to invalid URL: ${url}`);
            return;
        }

        // JSON Server doesn't support bulk replace of entire collection easily via standard REST
        // But our custom backend might, or we might need to iterate.
        // However, for 'config' or singleton objects, it might be different.
        // For arrays, replacing the whole array is dangerous/inefficient via REST.
        // BUT, the legacy code expects this behavior.
        // We will try to POST to a custom endpoint if available, or warn.

        // WORKAROUND: For now, we assume this is mostly used for 'config' or small lists.
        // If it's a large list, we should really use saveDocument.

        // If data is an array, we must iterate and saveDocument for each item
        // because json-server does not support bulk POST/PUT for collections.
        if (Array.isArray(data)) {
            if (data.length === 0) {
                console.log(`🗑️ NetworkAdapter: Clearing collection ${collectionName}...`);
                const url = this.getUrl(collectionName);
                await fetch(url, {
                    method: 'DELETE',
                    mode: 'cors',
                    headers: { 'Connection': 'keep-alive' }
                });
                return;
            }

            console.log(`📦 NetworkAdapter: Saving ${data.length} items to ${collectionName}...`);
            // Use Promise.all with concurrency limit to avoid flooding
            const chunks = [];
            const chunkSize = 5;
            for (let i = 0; i < data.length; i += chunkSize) {
                chunks.push(data.slice(i, i + chunkSize));
            }

            for (const chunk of chunks) {
                await Promise.all(chunk.map(item => this.saveDocument(collectionName, item)));
            }
            return;
        }

        // If it's a single object (like config), try PUT
        try {
            const res = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Connection': 'keep-alive'
                },
                mode: 'cors',
                body: JSON.stringify(data)
            });

            if (!res.ok) {
                if (res.status === 404) {
                    console.warn(`⚠️ Collection ${collectionName} not available on Master (404). Initializing local empty state.`);
                    return; // Graceful exit, do not throw
                }
                // If POST fails (e.g. duplicate), try PUT if it has ID? 
                // But data is the whole collection object here.
                throw new Error(`Failed to save ${collectionName}: ${res.status} ${res.statusText}`);
            }
        } catch (error) {
            console.error(`Error saving collection ${collectionName} to ${url}:`, error);
        }
    }

    async saveDocument<T extends { id: string }>(collectionName: string, doc: T): Promise<void> {
        if (!doc.id) {
            console.error(`❌ NetworkAdapter: Attempted to save document to ${collectionName} without ID.`, doc);
            return;
        }
        try {
            // Try to update first (PUT)
            const checkUrl = this.getUrl(`${collectionName}/${doc.id}`);
            const check = await fetch(checkUrl);

            if (check.ok) {
                // Update
                await fetch(checkUrl, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Connection': 'keep-alive'
                    },
                    mode: 'cors',
                    body: JSON.stringify(doc)
                });
            } else {
                // Create
                const createUrl = this.getUrl(collectionName);
                await fetch(createUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Connection': 'keep-alive'
                    },
                    mode: 'cors',
                    body: JSON.stringify(doc)
                });
            }
        } catch (error) {
            console.error(`Error saving document to ${collectionName}:`, error);
            throw error;
        }
    }

    async getDocument<T>(collectionName: string, id: string): Promise<T | null> {
        try {
            const url = this.getUrl(`${collectionName}/${id}`);
            const res = await fetch(url, {
                mode: 'cors',
                headers: { 'Connection': 'keep-alive' }
            });
            if (!res.ok) return null;
            return await res.json();
        } catch (error) {
            return null;
        }
    }

    async deleteDocument(collectionName: string, id: string): Promise<void> {
        try {
            const url = this.getUrl(`${collectionName}/${id}`);
            await fetch(url, {
                method: 'DELETE',
                mode: 'cors',
                headers: { 'Connection': 'keep-alive' }
            });
        } catch (error) {
            console.error(`Error deleting document from ${collectionName}:`, error);
        }
    }

    async getStats(): Promise<{ type: string; size: number; tables: number }> {
        return {
            type: 'Network Adapter (JSON Server)',
            size: 0, // Unknown
            tables: 0
        };
    }
}
