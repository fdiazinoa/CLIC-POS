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
            // Call the local backend API (proxied by Vite to port 3001)
            const response = await fetch(`/api/dgii/validate/${sanitizedRNC}`);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }

            const data: DGIIResponse = await response.json();

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
}

export const dgiiService = DGIIValidationService.getInstance();
export type { DGIIResponse };
