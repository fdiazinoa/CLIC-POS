import { useEffect, useRef } from 'react';
import { attachGlobalBarcodeCapture, type BarcodeCaptureOptions } from '../utils/globalBarcodeCapture';
import { extractInvoiceScanReferences, isRecognizedInvoiceScan } from '../utils/invoiceScan';

export const detectTicketPattern = (code: string): string | null => {
    if (!isRecognizedInvoiceScan(code)) return null;
    return extractInvoiceScanReferences(code)[0] || code.trim();
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
