import { useEffect, useRef } from 'react';
import { attachGlobalBarcodeCapture, type BarcodeCaptureOptions } from '../utils/globalBarcodeCapture';

export const detectTicketPattern = (code: string): string | null => {
    if (/^TCK/i.test(code) || /^B0[1-4]\d+/i.test(code)) return code.toUpperCase();
    if (code.includes('dgii.gov.do')) {
        try {
            const url = new URL(code);
            return url.searchParams.get('ncf') || url.searchParams.get('trackId') || null;
        } catch { return null; }
    }
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(code)) return code;
    return null;
};

export const useBarcodeScanner = ({ onScan, onTicketScan, enabled = true, prefixTimeout = 100, idleTimeout = 250 }:
    BarcodeCaptureOptions & { enabled?: boolean; onTicketScan?: (ticketId: string) => void }) => {
    const callbacks = useRef({ onScan, onTicketScan });
    useEffect(() => { callbacks.current = { onScan, onTicketScan }; }, [onScan, onTicketScan]);
    useEffect(() => {
        if (!enabled) return;
        return attachGlobalBarcodeCapture(window, {
            prefixTimeout, idleTimeout,
            onScan: code => {
                const ticket = detectTicketPattern(code);
                if (ticket && callbacks.current.onTicketScan) callbacks.current.onTicketScan(ticket);
                else callbacks.current.onScan(code);
            },
        });
    }, [enabled, prefixTimeout, idleTimeout]);
};
