import { useEffect, useRef } from 'react';

interface BarcodeScannerOptions {
    onScan: (barcode: string) => void;
    enabled?: boolean;
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
        const urlParams = new URL(code).searchParams;
        return urlParams.get('ncf') || urlParams.get('trackId') || null;
    }

    // 4. UUID fallback (if scanning raw ID)
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(code)) return code;

    return null;
};

export const useBarcodeScanner = ({
    onScan,
    onTicketScan,
    enabled = true,
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
    }, [onScan]);

    useEffect(() => {
        onTicketScanRef.current = onTicketScan;
    }, [onTicketScan]);

    useEffect(() => {
        if (!enabled) return;

        const emitScan = (rawCode: string) => {
            const code = rawCode.trim();
            if (code.length < 3) return false;

            console.log(`[Scanner] Detected code: ${code}`);
            const ticketId = detectTicketPattern(code);
            if (ticketId && onTicketScanRef.current) {
                console.log(`[Scanner] 🎫 Ticket Match: ${ticketId}`);
                onTicketScanRef.current(ticketId);
            } else {
                onScanRef.current(code);
            }
            return true;
        };

        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            const isScannerTarget = target.dataset?.barcodeScannerTarget === 'true';

            // CRITICAL: Identify if the event originated from an input field
            const isEditableInput = (
                (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') &&
                !(target as HTMLInputElement | HTMLTextAreaElement).readOnly &&
                !(target as HTMLInputElement | HTMLTextAreaElement).disabled
            );
            const isManualInput = isEditableInput || target.isContentEditable;

            // If user is typing in a text field, we MUST ignore global capture
            if (isManualInput && !isScannerTarget) {
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

            // PDA wedges commonly terminate with Enter or Tab. When the search
            // input has focus, its value is a fallback for slower scanners.
            if (e.key === 'Enter' || e.key === 'Tab') {
                const targetValue = isScannerTarget && target instanceof HTMLInputElement
                    ? target.value
                    : '';
                const code = buffer.current.length >= 3 ? buffer.current : targetValue;
                if (emitScan(code)) {
                    e.preventDefault();
                    e.stopPropagation();
                }
                buffer.current = '';
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

                // Some PDAs are configured without a suffix. Auto-submit only
                // from an explicitly marked scanner/search field after a burst.
                idleTimer.current = setTimeout(() => {
                    if (isScannerTarget) emitScan(buffer.current);
                    buffer.current = '';
                }, idleTimeout);
            }
        };

        window.addEventListener('keydown', handleGlobalKeyDown, true);

        return () => {
            window.removeEventListener('keydown', handleGlobalKeyDown, true);
            if (idleTimer.current) clearTimeout(idleTimer.current);
        };
    }, [enabled, prefixTimeout, idleTimeout]);
};
