
import { visorSync } from './utils/visorSync';

// Mock localStorage
const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: (key: string) => store[key] || null,
        setItem: (key: string, value: string) => { store[key] = value.toString(); },
        clear: () => { store = {}; }
    };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock BroadcastChannel
class MockBroadcastChannel {
    name: string;
    onmessage: ((this: BroadcastChannel, ev: MessageEvent) => any) | null = null;
    constructor(name: string) { this.name = name; }
    postMessage(message: any) { console.log(`[Broadcast] ${this.name}:`, message); }
    close() { }
    addEventListener() { }
    removeEventListener() { }
    dispatchEvent() { return true; }
}
(window as any).BroadcastChannel = MockBroadcastChannel;

// Test Data
const testState = {
    cart: [],
    subtotal: 100,
    tax: 18,
    discountAmount: 0,
    total: 118,
    welcomeMessage: 'Test Welcome',
    ads: [{ id: '1', url: 'http://test.com/ad1.jpg', active: true }],
    currencySymbol: '$'
};

// Simulation
console.log("--- Starting Visor Sync Test ---");
visorSync.pushState(testState);

const savedState = visorSync.getLastState();
console.log("Saved State in LocalStorage:", savedState);

if (savedState?.ads?.length === 1 && savedState.ads[0].url === 'http://test.com/ad1.jpg') {
    console.log("✅ SUCCESS: State correctly saved and retrieved.");
} else {
    console.error("❌ FAILURE: State mismatch.");
}
