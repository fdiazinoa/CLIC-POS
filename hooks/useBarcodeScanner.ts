import { useEffect, useRef } from 'react';
import { attachGlobalBarcodeCapture, canReceiveNativeBarcode, type BarcodeCaptureOptions } from '../utils/globalBarcodeCapture';
import { attachNativeBarcodeSubscription } from '../utils/nativeBarcodeSubscription';
import { isZebraEnabled, listenZebraBarcode, startZebra, zebraSettingEvent } from '../services/ZebraScanner';
import { extractInvoiceScanReferences, isRecognizedInvoiceScan } from '../utils/invoiceScan';

export const detectTicketPattern = (code: string): string | null => {
    if (!isRecognizedInvoiceScan(code)) return null;
    return extractInvoiceScanReferences(code)[0] || code.trim();
};

export const useBarcodeScanner = ({ onScan, onTicketScan, enabled = true, nativeOwner = false, prefixTimeout = 100, idleTimeout = 250 }:
    BarcodeCaptureOptions & { enabled?: boolean; nativeOwner?: boolean; onTicketScan?: (ticketId: string) => void }) => {
    const callbacks = useRef({ onScan, onTicketScan });
    useEffect(() => { callbacks.current = { onScan, onTicketScan }; }, [onScan, onTicketScan]);
    useEffect(() => {
        if (!enabled || !nativeOwner) return;
        return attachNativeBarcodeSubscription(window, {
            subscribe: listenZebraBarcode, start: startZebra, isEnabled: isZebraEnabled,
            settingEvent: zebraSettingEvent,
            canReceive: () => canReceiveNativeBarcode(window.document),
            getCallback: () => code => {
                const ticket = detectTicketPattern(code);
                if (ticket && callbacks.current.onTicketScan) callbacks.current.onTicketScan(ticket);
                else callbacks.current.onScan(code);
            },
            onError: error => console.warn('[Zebra]', error),
        });
    }, [enabled, nativeOwner]);
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
