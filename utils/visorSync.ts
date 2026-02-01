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
        if (this.channel) {
            this.channel.postMessage({ type: 'STATE_UPDATE', payload: state });
        }
    }

    /**
     * Listen for state updates (used by the Visor window)
     */
    public onStateUpdate(callback: (state: VisorState) => void) {
        if (!this.channel) return () => { };

        const handler = (event: MessageEvent) => {
            if (event.data?.type === 'STATE_UPDATE') {
                callback(event.data.payload);
            }
        };

        this.channel.addEventListener('message', handler);
        return () => this.channel?.removeEventListener('message', handler);
    }

    public close() {
        this.channel?.close();
    }
}

export const visorSync = new VisorSyncService();
