import { CartItem } from '../types';

export interface VisorState {
    cart: CartItem[];
    subtotal: number;
    tax: number;
    discountAmount: number;
    total: number;
    welcomeMessage?: string;
    ads?: { id: string; url: string; active: boolean }[];
    currencySymbol: string;
}

const CHANNEL_NAME = 'clic-pos-visor-sync';
const STORAGE_KEY = 'clic_pos_visor_state';

class VisorSyncService {
    private channel: BroadcastChannel | null = null;

    constructor() {
        if (typeof window !== 'undefined') {
            this.channel = new BroadcastChannel(CHANNEL_NAME);
        }
    }

    /**
     * Send the current POS state to the visor
     */
    public pushState(state: VisorState) {
        if (typeof window !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        }
        if (this.channel) {
            this.channel.postMessage({ type: 'STATE_UPDATE', payload: state });
        }
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

        const broadcastHandler = (event: MessageEvent) => {
            if (event.data?.type === 'STATE_UPDATE') {
                callback(event.data.payload);
            }
        };

        const storageHandler = (event: StorageEvent) => {
            if (event.key === STORAGE_KEY && event.newValue) {
                try {
                    callback(JSON.parse(event.newValue));
                } catch (e) {
                    console.error("Error parsing visor state from storage:", e);
                }
            }
        };

        this.channel?.addEventListener('message', broadcastHandler);
        window.addEventListener('storage', storageHandler);

        return () => {
            this.channel?.removeEventListener('message', broadcastHandler);
            window.removeEventListener('storage', storageHandler);
        };
    }

    public close() {
        this.channel?.close();
    }
}

export const visorSync = new VisorSyncService();
