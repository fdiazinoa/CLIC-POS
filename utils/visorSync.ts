import { CartItem, CustomerDisplayAd } from '../types';

export interface VisorCartItem {
    id?: string;
    cartId?: string;
    name: string;
    quantity: number;
    price: number;
    originalPrice?: number;
    discountAmount?: number;
    discountRate?: number;
    adjustmentSource?: string;
    appliedPromotionName?: string;
}

export interface VisorState {
    cart: VisorCartItem[];
    subtotal: number;
    tax: number;
    discountAmount: number;
    total: number;
    welcomeMessage?: string;
    ads?: CustomerDisplayAd[];
    currencySymbol: string;
}

export type VisorStateInput = Omit<VisorState, 'cart'> & {
    cart: Array<CartItem | VisorCartItem>;
};

const CHANNEL_NAME = 'clic-pos-visor-sync';
const STORAGE_KEY = 'clic_pos_visor_state';
const WRITE_DEBOUNCE_MS = 300;

const toNumber = (value: unknown): number => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
};

const stripCartItemForVisor = (item: CartItem | VisorCartItem): VisorCartItem => {
    const source = item as any;
    const stripped: VisorCartItem = {
        id: typeof source.id === 'string' ? source.id : undefined,
        cartId: typeof source.cartId === 'string' ? source.cartId : undefined,
        name: typeof source.name === 'string' ? source.name : 'Artículo',
        quantity: toNumber(source.quantity),
        price: toNumber(source.price),
    };

    if (Number.isFinite(Number(source.originalPrice))) {
        stripped.originalPrice = toNumber(source.originalPrice);
    }
    if (Number.isFinite(Number(source.discountAmount))) {
        stripped.discountAmount = toNumber(source.discountAmount);
    }
    if (Number.isFinite(Number(source.discountRate))) {
        stripped.discountRate = toNumber(source.discountRate);
    }
    if (typeof source.adjustmentSource === 'string') {
        stripped.adjustmentSource = source.adjustmentSource;
    }
    if (typeof source.appliedPromotionName === 'string') {
        stripped.appliedPromotionName = source.appliedPromotionName;
    }

    return stripped;
};

const stripStateForVisor = (state: VisorStateInput): VisorState => ({
    cart: Array.isArray(state.cart) ? state.cart.map(stripCartItemForVisor) : [],
    subtotal: toNumber(state.subtotal),
    tax: toNumber(state.tax),
    discountAmount: toNumber(state.discountAmount),
    total: toNumber(state.total),
    welcomeMessage: state.welcomeMessage,
    ads: Array.isArray(state.ads)
        ? state.ads.map((ad) => ({
            id: ad.id,
            type: ad.type,
            url: ad.url,
            posterUrl: ad.posterUrl,
            mimeType: ad.mimeType,
            sortOrder: ad.sortOrder,
            active: Boolean(ad.active),
        }))
        : undefined,
    currencySymbol: state.currencySymbol || '$',
});

class VisorSyncService {
    private channel: BroadcastChannel | null = null;
    private pendingStateInput: VisorStateInput | null = null;
    private writeTimer: number | null = null;

    constructor() {
        if (typeof window !== 'undefined') {
            this.channel = new BroadcastChannel(CHANNEL_NAME);
        }
    }

    /**
     * Send the current POS state to the visor
     */
    public pushState(state: VisorStateInput) {
        if (typeof window === 'undefined') return;

        // Keep the hot path light: stripping + JSON.stringify happen after the
        // UI has had a chance to render the cart update.
        this.pendingStateInput = state;

        if (this.writeTimer) {
            window.clearTimeout(this.writeTimer);
        }

        this.writeTimer = window.setTimeout(() => {
            this.writeTimer = null;
            this.scheduleIdleFlush();
        }, WRITE_DEBOUNCE_MS);
    }

    private scheduleIdleFlush() {
        if (typeof window === 'undefined') return;

        const flush = () => this.flushPendingState();
        const requestIdle = (window as any).requestIdleCallback as
            | ((callback: () => void, options?: { timeout?: number }) => number)
            | undefined;

        if (typeof requestIdle === 'function') {
            requestIdle(flush, { timeout: 500 });
            return;
        }

        window.setTimeout(flush, 0);
    }

    private flushPendingState() {
        if (typeof window === 'undefined' || !this.pendingStateInput) return;

        const input = this.pendingStateInput;
        this.pendingStateInput = null;
        const state = stripStateForVisor(input);

        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (error) {
            console.warn('[visorSync] No se pudo guardar el estado del visor:', error);
        }

        this.channel?.postMessage({ type: 'STATE_UPDATE', payload: state });
    }

    /**
     * Get the last known state from localStorage
     */
    public getLastState(): VisorState | null {
        if (typeof window === 'undefined') return null;
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            return saved ? JSON.parse(saved) : null;
        } catch (e) {
            console.error("Error retrieving visor state:", e);
            return null;
        }
    }

    /**
     * Listen for state updates (used by the Visor window)
     */
    public onStateUpdate(callback: (state: VisorState) => void) {
        if (typeof window === 'undefined') return () => { };
        let lastSerialized = '';

        const broadcastHandler = (event: MessageEvent) => {
            if (event.data?.type === 'STATE_UPDATE') {
                lastSerialized = JSON.stringify(event.data.payload);
                callback(event.data.payload);
            }
        };

        const storageHandler = (event: StorageEvent) => {
            if (event.key === STORAGE_KEY && event.newValue) {
                try {
                    lastSerialized = event.newValue;
                    callback(JSON.parse(event.newValue));
                } catch (e) {
                    console.error("Error parsing visor state from storage:", e);
                }
            }
        };

        const poller = window.setInterval(() => {
            try {
                const latest = localStorage.getItem(STORAGE_KEY);
                if (!latest || latest === lastSerialized) return;
                lastSerialized = latest;
                callback(JSON.parse(latest));
            } catch (e) {
                console.error("Error polling visor state from storage:", e);
            }
        }, 750);

        this.channel?.addEventListener('message', broadcastHandler);
        window.addEventListener('storage', storageHandler);

        return () => {
            this.channel?.removeEventListener('message', broadcastHandler);
            window.removeEventListener('storage', storageHandler);
            window.clearInterval(poller);
        };
    }

    public close() {
        if (this.writeTimer && typeof window !== 'undefined') {
            window.clearTimeout(this.writeTimer);
            this.writeTimer = null;
        }
        this.pendingStateInput = null;
        this.channel?.close();
    }
}

export const visorSync = new VisorSyncService();
