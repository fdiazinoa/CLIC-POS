import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { X, Camera, Zap, ZapOff, ScanBarcode } from 'lucide-react';

interface BarcodeScannerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onScan: (code: string) => Promise<{ success: boolean; message?: string }>;
}

const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({ isOpen, onClose, onScan }) => {
    const [isScanning, setIsScanning] = useState(false);
    const [torchOn, setTorchOn] = useState(false);
    const [cameraError, setCameraError] = useState<string | null>(null);
    const lastScanTimeRef = useRef<number>(0);
    const [feedback, setFeedback] = useState<{ type: 'success' | 'error', message: string } | null>(null);

    const scannerRef = useRef<Html5Qrcode | null>(null);
    const regionId = "html5-qrcode-reader";

    // Base64 Beep Sound (Short, high-pitched)
    const BEEP_SOUND = "data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YV9vT18AZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC";

    const playSound = (type: 'success' | 'error') => {
        if (type !== 'success') return; // Only beep on success as per request

        try {
            const audio = new Audio(BEEP_SOUND);
            audio.volume = 0.5;
            const playPromise = audio.play();

            if (playPromise !== undefined) {
                playPromise.catch(error => {
                    console.warn("Autoplay prevented or audio failed:", error);
                });
            }
        } catch (e) {
            console.error("Audio playback failed", e);
        }
    };

    const triggerVibration = (pattern: number | number[]) => {
        if (navigator.vibrate) {
            navigator.vibrate(pattern);
        }
    };

    useEffect(() => {
        if (isOpen && !scannerRef.current) {
            startScanner();
        } else if (!isOpen && scannerRef.current) {
            stopScanner();
        }

        return () => {
            if (scannerRef.current) {
                stopScanner();
            }
        };
    }, [isOpen]);

    const startScanner = async () => {
        setCameraError(null);
        try {
            const formatsToSupport = [
                Html5QrcodeSupportedFormats.EAN_13,
                Html5QrcodeSupportedFormats.EAN_8,
                Html5QrcodeSupportedFormats.CODE_128,
                Html5QrcodeSupportedFormats.CODE_39,
                Html5QrcodeSupportedFormats.UPC_A,
                Html5QrcodeSupportedFormats.UPC_E,
                Html5QrcodeSupportedFormats.QR_CODE,
            ];

            const html5QrCode = new Html5Qrcode(regionId);
            scannerRef.current = html5QrCode;

            const config = {
                fps: 10,
                qrbox: { width: 250, height: 250 },
                aspectRatio: 1.0,
                formatsToSupport: formatsToSupport
            };

            await html5QrCode.start(
                { facingMode: "environment" },
                config,
                async (decodedText) => {
                    const now = Date.now();
                    // Debounce: 1.5s using Ref for immediate check
                    if (now - lastScanTimeRef.current < 1500) {
                        return;
                    }

                    // Update timestamp immediately
                    lastScanTimeRef.current = now;

                    try {
                        const result = await onScan(decodedText);

                        if (result.success) {
                            playSound('success');
                            setFeedback({ type: 'success', message: result.message || 'Producto Agregado' });
                            // Don't vibrate on success to keep it smooth, or maybe a short tick
                            triggerVibration(50);
                        } else {
                            playSound('error');
                            triggerVibration([100, 50, 100]); // Double buzz
                            setFeedback({ type: 'error', message: result.message || 'Producto no encontrado' });
                        }
                    } catch (e) {
                        console.error("Scan processing error", e);
                        playSound('error');
                    }

                    // Clear feedback after 2s
                    setTimeout(() => setFeedback(null), 2000);
                },
                (errorMessage) => {
                    // Ignore scan errors, they happen constantly when no code is in view
                }
            );
            setIsScanning(true);
        } catch (err: any) {
            console.error("Error starting scanner", err);
            let msg = "No se pudo acceder a la cámara.";
            if (err?.name === 'NotAllowedError') msg = "Permiso denegado. Habilite el acceso a la cámara.";
            if (err?.name === 'NotFoundError') msg = "No se encontró ninguna cámara.";
            if (err?.name === 'NotReadableError') msg = "La cámara está en uso por otra aplicación.";
            if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost') {
                msg += " (Requiere HTTPS o localhost)";
            }
            setCameraError(`${msg} [${err?.name || 'Error'}: ${err?.message || JSON.stringify(err)}]`);
        }
    };

    const stopScanner = async () => {
        if (scannerRef.current) {
            try {
                await scannerRef.current.stop();
                scannerRef.current.clear();
            } catch (e) {
                console.error("Error stopping scanner", e);
            }
            scannerRef.current = null;
            setIsScanning(false);
        }
    };

    const toggleTorch = () => {
        if (scannerRef.current) {
            const newTorchState = !torchOn;
            scannerRef.current.applyVideoConstraints({
                advanced: [{ torch: newTorchState }]
            } as any).then(() => {
                setTorchOn(newTorchState);
            }).catch(e => {
                console.warn("Torch not supported", e);
            });
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] bg-black flex flex-col">
            {/* Header */}
            <div className="flex justify-between items-center p-4 bg-black/50 absolute top-0 left-0 right-0 z-10">
                <div className="text-white flex items-center gap-2">
                    <ScanBarcode className="text-blue-400" />
                    <span className="font-bold">Escáner Rápido</span>
                </div>
                <button onClick={onClose} className="p-2 bg-white/10 rounded-full text-white hover:bg-white/20">
                    <X size={24} />
                </button>
            </div>

            {/* Camera Viewport */}
            <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
                <div id={regionId} className="w-full h-full object-cover"></div>

                {/* Overlay Guides */}
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div className="w-64 h-64 border-2 border-blue-500/50 rounded-3xl relative">
                        <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-blue-400 rounded-tl-xl"></div>
                        <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-blue-400 rounded-tr-xl"></div>
                        <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-blue-400 rounded-bl-xl"></div>
                        <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-blue-400 rounded-br-xl"></div>

                        {/* Scanning Line Animation */}
                        <div className="absolute top-0 left-0 right-0 h-0.5 bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)] animate-[scan_2s_ease-in-out_infinite]"></div>
                    </div>
                </div>

                {/* Feedback Toast */}
                {feedback && (
                    <div className={`absolute top-1/4 left-1/2 -translate-x-1/2 px-6 py-3 rounded-full shadow-2xl font-bold text-white flex items-center gap-2 animate-in zoom-in-90 ${feedback.type === 'success' ? 'bg-emerald-500' : 'bg-red-500'}`}>
                        {feedback.type === 'success' ? <Camera size={20} /> : <ZapOff size={20} />}
                        {feedback.message}
                    </div>
                )}

                {cameraError && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-900 text-white p-8 text-center">
                        <div>
                            <Camera size={48} className="mx-auto mb-4 text-gray-600" />
                            <p className="text-lg font-bold mb-2">Cámara no disponible</p>
                            <p className="text-sm text-gray-400">{cameraError}</p>
                        </div>
                    </div>
                )}
            </div>

            {/* Controls Footer */}
            <div className="p-6 bg-gray-900 pb-10 flex justify-between items-center gap-4">
                <button
                    onClick={toggleTorch}
                    className={`p-4 rounded-full ${torchOn ? 'bg-yellow-400 text-black' : 'bg-gray-800 text-gray-400'}`}
                >
                    <Zap size={24} fill={torchOn ? "currentColor" : "none"} />
                </button>

                <div className="text-center">
                    <p className="text-gray-400 text-xs uppercase tracking-widest mb-1">Modo Continuo</p>
                    <p className="text-white font-bold text-sm">Escanee múltiples productos</p>
                </div>

                <button
                    onClick={onClose}
                    className="px-6 py-3 bg-gray-800 text-white rounded-xl font-bold hover:bg-gray-700"
                >
                    LISTO
                </button>
            </div>

            <style>{`
                @keyframes scan {
                    0% { top: 10%; opacity: 0; }
                    10% { opacity: 1; }
                    90% { opacity: 1; }
                    100% { top: 90%; opacity: 0; }
                }
            `}</style>
        </div>
    );
};

export default BarcodeScannerModal;
