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
export const useBarcodeScanner = ({
    onScan,
    enabled = true,
    prefixTimeout = 50,
    idleTimeout = 200
}: BarcodeScannerOptions) => {
    const buffer = useRef<string>('');
    const lastKeyTime = useRef<number>(0);
    const idleTimer = useRef<NodeJS.Timeout | null>(null);

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
            // to avoid interfering with manual entry or "hijacking" their typing.
            // User explicit requirement: "Si el foco está actualmente en un input... ignorar la captura"
            if (isManualInput) {
                // We do NOT clear the buffer here, because they might be typing fast manually
                // but we also don't want to swallow their events.
                // Just return and let the event bubble normally.
                return;
            }

            const currentTime = Date.now();
            const gap = currentTime - lastKeyTime.current;
            lastKeyTime.current = currentTime;

            // Clear the idle clearing timer on any activity
            if (idleTimer.current) clearTimeout(idleTimer.current);

            // If idle for too long, previous buffer is definitely stale/human noise
            if (gap > idleTimeout) {
                buffer.current = '';
            }

            // Handle Enter - The signal that scanning is complete
            if (e.key === 'Enter') {
                // Only fire if buffer has significant length (standard barcodes are usually 8+ chars)
                // Short inputs (e.g. "1", "OK") might be keyboard navigation noise.
                // Assuming minimum reasonable barcode length is 3.
                if (buffer.current.length >= 3) {
                    console.log(`[Scanner] Detected code: ${buffer.current}`);
                    onScan(buffer.current);
                    buffer.current = '';

                    // Prevent "Enter" from triggering other actions
                    e.preventDefault();
                    e.stopPropagation();
                } else {
                    buffer.current = '';
                }
                return;
            }

            // Capture printable characters (alphanumeric + symbols)
            // Ignore specialized keys like Shift, Control, Alt, Arrows, etc.
            if (e.key.length === 1) {
                // Speed Detection:
                // Scanners are superhumanly fast (~10-20ms per key caused by USB/keyboard emulation buffering).
                // Humans are usually > 100ms per key, rarely faster than 50ms unless mashing.

                if (buffer.current === '') {
                    // First character of a potential scan starts the sequence
                    buffer.current = e.key;
                } else {
                    if (gap < prefixTimeout) {
                        // Fast sequence detected - looks like a machine!
                        buffer.current += e.key;
                    } else {
                        // Slow sequence - looks like a human.
                        // Reset buffer and assume this is just noise or slow navigation.
                        buffer.current = e.key; // Reset start with this new key
                    }
                }

                // Set idle timer to clear buffer if input stops (e.g. half-scan)
                idleTimer.current = setTimeout(() => {
                    buffer.current = '';
                }, idleTimeout);
            }
        };

        // We use capture phase (true) to intercept keyboard events before they reach focused elements
        // BUT we have the early exit check for `isManualInput` to respect focus.
        window.addEventListener('keydown', handleGlobalKeyDown, true);

        return () => {
            window.removeEventListener('keydown', handleGlobalKeyDown, true);
            if (idleTimer.current) clearTimeout(idleTimer.current);
        };
    }, [enabled, onScan, prefixTimeout, idleTimeout]);
};
