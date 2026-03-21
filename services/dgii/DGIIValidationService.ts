/**
 * DGII (Dirección General de Impuestos Internos) RNC Validation Service
 * 
 * Update: Now proxies requests through the backend `/api/dgii/validate/:rnc`
 * to avoid CORS issues and ensure reliable scraping.
 */

interface DGIIResponse {
    rnc: string;
    name: string;
    commercialName?: string;
    status: 'ACTIVO' | 'INACTIVO' | 'NO_REGISTRADO';
    regimeType?: string;
    economicActivity?: string;
    error?: string;
}

interface CacheEntry {
    data: DGIIResponse;
    cachedAt: number;
}

class DGIIValidationService {
    private static instance: DGIIValidationService;
    private cache = new Map<string, CacheEntry>();
    private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

    private constructor() { }

    static getInstance(): DGIIValidationService {
        if (!DGIIValidationService.instance) {
            DGIIValidationService.instance = new DGIIValidationService();
        }
        return DGIIValidationService.instance;
    }

    /**
     * Validates an RNC/Cédula against DGII registry via Backend API
     */
    async validateRNC(rnc: string): Promise<DGIIResponse> {
        const sanitizedRNC = rnc.replace(/[^0-9]/g, '');

        if (!sanitizedRNC || sanitizedRNC.length < 9 || sanitizedRNC.length > 11) {
            return {
                rnc: sanitizedRNC,
                name: '',
                status: 'NO_REGISTRADO',
                error: 'RNC inválido: debe contener entre 9 y 11 dígitos'
            };
        }

        // Check cache first
        const cached = this.cache.get(sanitizedRNC);
        if (cached && (Date.now() - cached.cachedAt) < this.CACHE_TTL_MS) {
            console.log(`📋 [DGII Client] Cache hit for RNC ${sanitizedRNC}`);
            return cached.data;
        }

        try {
            console.log(`🔍 [DGII Client] Querying API for ${sanitizedRNC}`);
            const endpoints = this.buildEndpointCandidates(sanitizedRNC);
            let lastError: Error | null = null;
            let data: DGIIResponse | null = null;

            for (const endpoint of endpoints) {
                try {
                    const response = await fetch(endpoint);

                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({}));
                        throw new Error(errorData.error || `HTTP ${response.status}`);
                    }

                    data = await response.json();
                    break;
                } catch (error: any) {
                    lastError = error instanceof Error ? error : new Error(String(error));
                    console.warn(`⚠️ [DGII Client] Endpoint failed: ${endpoint}`, lastError.message);
                }
            }

            if (!data) {
                throw lastError || new Error('No se pudo conectar con el servicio DGII');
            }

            // Cache successful result
            this.cache.set(sanitizedRNC, { data, cachedAt: Date.now() });

            return data;

        } catch (error: any) {
            console.error('❌ [DGII Client] Error:', error);
            return {
                rnc: sanitizedRNC,
                name: '',
                status: 'NO_REGISTRADO',
                error: error.message || 'Error conectando con servicio DGII'
            };
        }
    }

    clearCache(): void {
        this.cache.clear();
    }

    private buildEndpointCandidates(rnc: string): string[] {
        const seen = new Set<string>();
        const add = (value?: string | null) => {
            if (!value) return;
            if (seen.has(value)) return;
            seen.add(value);
        };

        add(`/api/dgii/validate/${rnc}`);

        if (typeof window !== 'undefined') {
            const { protocol, hostname } = window.location;
            if (hostname) {
                add(`${protocol}//${hostname}:3001/api/dgii/validate/${rnc}`);
            }
        }

        add(`http://localhost:3001/api/dgii/validate/${rnc}`);
        add(`http://127.0.0.1:3001/api/dgii/validate/${rnc}`);

        return Array.from(seen);
    }
}

export const dgiiService = DGIIValidationService.getInstance();
export type { DGIIResponse };
