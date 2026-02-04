import { useEffect, useRef } from 'react';

interface BarcodeScannerOptions {
    onScan: (barcode: string) => void;
    enabled?: boolean;
    prefixTimeout?: number; // Time threshold to detect scanner vs human (< 30ms)
    idleTimeout?: number;   // Time threshold to clear buffer if no key (> 100ms)
}

/**
 * Hook to detect barcode scanner input globally.
 * Barcode scanners typically type characters very fast (< 30ms gap)
 * and end with an 'Enter' key.
 */
export const useBarcodeScanner = ({
    onScan,
    enabled = true,
    prefixTimeout = 30,
    idleTimeout = 100
}: BarcodeScannerOptions) => {
    const buffer = useRef<string>('');
    const lastKeyTime = useRef<number>(0);
    const idleTimer = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (!enabled) return;

        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;

            // Identify if the event originated from an input field
            const isManualInput = (
                target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.isContentEditable
            );

            const currentTime = Date.now();
            const gap = currentTime - lastKeyTime.current;
            lastKeyTime.current = currentTime;

            // Clear the idle clearing timer on any activity
            if (idleTimer.current) clearTimeout(idleTimer.current);

            // If idle for too long, previous buffer is definitely stale/human
            if (gap > idleTimeout) {
                buffer.current = '';
            }

            // Handle Enter - The signal that scanning is complete
            if (e.key === 'Enter') {
                // Only fire if buffer has significant length (standard barcodes are usually 8+ chars)
                if (buffer.current.length >= 3) {
                    onScan(buffer.current);
                    buffer.current = '';

                    // Prevent "Enter" from triggering submission in the focused element
                    e.preventDefault();
                    e.stopPropagation();
                } else {
                    buffer.current = '';
                }
                return;
            }

            // Capture single printable characters
            if (e.key.length === 1) {
                // Speed Detection:
                // First char has no gap, so we always accept it into buffer.
                // Subsequent chars must be fast (< 30ms) to be considered part of a scan.

                if (buffer.current === '') {
                    // Initial character of a potential scan
                    buffer.current = e.key;
                } else {
                    if (gap < prefixTimeout) {
                        // Fast sequence detected - append to buffer
                        buffer.current += e.key;

                        // If we are in an input field and we are certain it's a scanner (length > 1),
                        // prevent the character from appearing in the UI field.
                        if (isManualInput) {
                            e.preventDefault();
                            e.stopPropagation();
                        }
                    } else {
                        // Slow sequence - this is a human. 
                        // Reset buffer and let the event propagate normally.
                        buffer.current = '';
                    }
                }

                // Set idle timer to clear buffer if input stops (e.g. half-scan or human typing one key)
                idleTimer.current = setTimeout(() => {
                    buffer.current = '';
                }, idleTimeout);
            }
        };

        // We use capture phase (true) to intercept keyboard events before they reach focused elements
        window.addEventListener('keydown', handleGlobalKeyDown, true);

        return () => {
            window.removeEventListener('keydown', handleGlobalKeyDown, true);
            if (idleTimer.current) clearTimeout(idleTimer.current);
        };
    }, [enabled, onScan, prefixTimeout, idleTimeout]);
};
