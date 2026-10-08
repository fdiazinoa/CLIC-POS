import { useEffect, useRef } from 'react';
import { isZebraEnabled, listenZebraBarcode, startZebra, zebraSettingEvent } from '../services/ZebraScanner';

interface BarcodeScannerOptions {
    onScan: (barcode: string) => void;
    enabled?: boolean;
    receiveNative?: boolean;
    prefixTimeout?: number; // Time threshold to detect scanner vs human (< 50ms)
    idleTimeout?: number;   // Time threshold to clear buffer if no key (> 100ms)
}

/**
 * Hook to detect barcode scanner input globally.
 * Barcode scanners typically type characters very fast (< 30-50ms gap)
 * and end with an 'Enter' key.
 */
// Helper to identify if a scanned code is a Ticket/Invoice
const detectTicketPattern = (code: string): string | null => {
    // 1. Internal Ticket ID (TCK...)
    if (/^TCK/i.test(code)) return code.toUpperCase();

    // 2. Fiscal NCF (B0...)
    if (/^B0[1-4]\d+/i.test(code)) return code.toUpperCase();

    // 3. DGII URL (extract NCF or TrackId)
    if (code.includes('dgii.gov.do')) {
        // Try to extract NCF param
        try {
            const urlParams = new URL(code).searchParams;
            return urlParams.get('ncf') || urlParams.get('trackId') || null;
        } catch { return null; }
    }

    // 4. UUID fallback (if scanning raw ID)
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(code)) return code;

    return null;
};

export const useBarcodeScanner = ({
    onScan,
    onTicketScan,
    enabled = true,
    receiveNative = true,
    prefixTimeout = 50,
    idleTimeout = 200
}: BarcodeScannerOptions & { onTicketScan?: (ticketId: string) => void }) => {
    const buffer = useRef<string>('');
    const lastKeyTime = useRef<number>(0);
    const idleTimer = useRef<NodeJS.Timeout | null>(null);
    const onScanRef = useRef(onScan);
    const onTicketScanRef = useRef(onTicketScan);

    useEffect(() => {
        onScanRef.current = onScan;
        onTicketScanRef.current = onTicketScan;
    }, [onScan, onTicketScan]);

    useEffect(() => {
        if (!enabled || !receiveNative) return;
        let disposed = false;
        let remove: (() => void) | undefined;
        const start = () => {
            if (isZebraEnabled()) void startZebra().catch(error => console.warn('[Zebra]', error));
        };
        void listenZebraBarcode(barcode => {
            if (disposed) return;
            const ticketId = detectTicketPattern(barcode);
            if (ticketId && onTicketScanRef.current) onTicketScanRef.current(ticketId);
            else onScanRef.current(barcode);
        }).then(handle => {
            if (disposed) void handle.remove();
            else remove = () => { void handle.remove(); };
            if (!disposed) start();
        }).catch(() => { /* Native plugin is absent on web and older APKs. */ });
        window.addEventListener(zebraSettingEvent, start);
        return () => {
            disposed = true;
            remove?.();
            window.removeEventListener(zebraSettingEvent, start);
        };
    }, [enabled, receiveNative]);

    useEffect(() => {
        if (!enabled) return;

        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;

            // CRITICAL: Identify if the event originated from an input field
            const isManualInput = (
                target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.isContentEditable
            );

            // If user is typing in a text field, we MUST ignore global capture
            if (isManualInput) {
                return;
            }

            const currentTime = Date.now();
            const gap = currentTime - lastKeyTime.current;
            lastKeyTime.current = currentTime;

            if (idleTimer.current) clearTimeout(idleTimer.current);

            // If idle for too long, previous buffer is definitely stale/human noise
            if (gap > idleTimeout) {
                buffer.current = '';
            }

            // Handle Enter - The signal that scanning is complete
            if (e.key === 'Enter') {
                if (buffer.current.length >= 3) {
                    console.log(`[Scanner] Detected code: ${buffer.current}`);

                    const ticketId = detectTicketPattern(buffer.current);
                    if (ticketId && onTicketScan) {
                        console.log(`[Scanner] 🎫 Ticket Match: ${ticketId}`);
                        onTicketScan(ticketId);
                    } else {
                        onScan(buffer.current);
                    }

                    buffer.current = '';
                    e.preventDefault();
                    e.stopPropagation();
                } else {
                    buffer.current = '';
                }
                return;
            }

            // Capture printable characters
            if (e.key.length === 1) {
                if (buffer.current === '') {
                    buffer.current = e.key;
                } else {
                    if (gap < prefixTimeout) {
                        buffer.current += e.key;
                    } else {
                        buffer.current = e.key; // Reset start with this new key
                    }
                }

                idleTimer.current = setTimeout(() => {
                    buffer.current = '';
                }, idleTimeout);
            }
        };

        window.addEventListener('keydown', handleGlobalKeyDown, true);

        return () => {
            window.removeEventListener('keydown', handleGlobalKeyDown, true);
            if (idleTimer.current) clearTimeout(idleTimer.current);
        };
    }, [enabled, onScan, onTicketScan, prefixTimeout, idleTimeout]);
};
