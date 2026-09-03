import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useBarcodeScanner } from '../../hooks/useBarcodeScanner';
import { focusSalesScannerInput } from '../../utils/globalBarcodeCapture';

// No APIs or persistence: counts routing events, never creates a sale.
function ScannerQA() {
    const [value, setValue] = useState('');
    const [scans, setScans] = useState<string[]>([]);
    const [manual, setManual] = useState(0);
    const [modal, setModal] = useState(false);
    // Deliberately do not clear from onScan: unknown codes and other routes
    // must leave the controlled input ready without help from catalog lookup.
    useBarcodeScanner({ onScan: code => { setScans(prev => [...prev, code]); } });
    useEffect(() => { focusSalesScannerInput(document); }, [modal]);
    return <main data-pos-scanner-enabled={modal ? 'false' : 'true'}>
        <input aria-label="Search" data-barcode-scanner-target="true" value={value}
            onChange={event => setValue(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') setManual(count => count + 1); }} />
        <input aria-label="Customer notes" />
        <button onClick={() => setModal(!modal)}>Toggle modal</button>
        {modal && <div role="dialog">Payment is open</div>}
        <output id="scans">{JSON.stringify(scans)}</output>
        <output id="manual">{manual}</output>
        <output id="search-state">{value}</output>
    </main>;
}
createRoot(document.getElementById('root')!).render(<ScannerQA />);
