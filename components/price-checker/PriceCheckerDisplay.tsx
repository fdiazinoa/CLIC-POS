import React, { useState, useEffect, useRef } from 'react';
import {
    ScanBarcode,
    Tag,
    Box,
    Barcode as BarcodeIcon,
    ImageOff,
    Keyboard,
    X,
    CheckCircle2,
    AlertCircle,
    Sparkles
} from 'lucide-react';
import { Product } from '../../types';

interface PriceCheckerDisplayProps {
    products: Product[];
    onScan?: (barcode: string) => void;
}

const PriceCheckerDisplay: React.FC<PriceCheckerDisplayProps> = ({
    products,
    onScan
}) => {
    const [scannedProduct, setScannedProduct] = useState<Product | null>(null);
    const [scanInput, setScanInput] = useState('');
    const [notFound, setNotFound] = useState(false);
    const [showManualInput, setShowManualInput] = useState(false);
    const [manualCode, setManualCode] = useState('');
    const [resetKey, setResetKey] = useState(0); // For progress bar animation reset

    // Auto-reset after 5 seconds
    useEffect(() => {
        if (scannedProduct || notFound) {
            setResetKey(prev => prev + 1);
            const timer = setTimeout(() => {
                handleClear();
            }, 5000);

            return () => clearTimeout(timer);
        }
    }, [scannedProduct, notFound]);

    const handleClear = () => {
        setScannedProduct(null);
        setNotFound(false);
        setScanInput('');
        setManualCode('');
        setShowManualInput(false);
    };

    const handleScan = (barcode: string) => {
        const term = barcode.toLowerCase().trim();
        const product = products.find(p =>
            p.barcode?.toLowerCase() === term ||
            p.id.toLowerCase() === term
        );

        if (product) {
            setScannedProduct(product);
            setNotFound(false);
            setShowManualInput(false);
            onScan?.(barcode);
        } else {
            setNotFound(true);
            setScannedProduct(null);
            setShowManualInput(false);
        }
    };

    const onManualSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (manualCode.trim()) {
            handleScan(manualCode.trim());
        }
    };

    // Simulated keyboard scanner listener
    useEffect(() => {
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            if (showManualInput) return;

            if (e.key === 'Enter') {
                if (scanInput.trim()) {
                    handleScan(scanInput.trim());
                    setScanInput('');
                }
            } else if (e.key.length === 1) {
                setScanInput(prev => prev + e.key);
            }
        };

        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, [scanInput, showManualInput, products]);

    return (
        <div className="w-full h-full min-h-screen bg-gray-50 flex flex-col items-center justify-center font-sans overflow-hidden p-6 md:p-12 relative">

            {/* 1. IDLE SCREEN (SCAN VIEW) */}
            {!scannedProduct && !notFound && (
                <div className="flex flex-col items-center text-center max-w-2xl animate-in fade-in zoom-in-95 duration-500">
                    <div className="mb-8 relative">
                        <div className="absolute inset-0 bg-blue-500/10 rounded-full scale-150 animate-ping opacity-20" />
                        <div className="relative bg-white p-12 rounded-[3rem] shadow-2xl shadow-blue-500/10 border border-blue-50">
                            <ScanBarcode size={120} className="text-blue-600 animate-pulse" strokeWidth={1.5} />
                        </div>
                    </div>

                    <h1 className="text-5xl font-black text-gray-900 mb-4 tracking-tighter">
                        Consulta de Precios
                    </h1>
                    <p className="text-xl text-gray-400 font-medium mb-12">
                        Acerca el código de barras al lector o presiona el botón para escribir manualmente.
                    </p>

                    <button
                        onClick={() => setShowManualInput(true)}
                        className="group flex items-center gap-3 px-8 py-5 bg-white border-2 border-gray-100 rounded-3xl text-gray-600 font-bold text-lg shadow-sm hover:border-blue-200 hover:text-blue-600 hover:shadow-xl hover:shadow-blue-500/5 transition-all duration-300"
                    >
                        <Keyboard size={24} className="group-hover:scale-110 transition-transform" />
                        Digitar Código
                    </button>
                </div>
            )}

            {/* 2. RESULT VIEW (PRODUCT FOUND) */}
            {scannedProduct && (
                <div className="w-full max-w-5xl bg-white rounded-[2.5rem] shadow-2xl shadow-blue-900/5 border border-gray-100 overflow-hidden flex flex-col md:flex-row animate-in slide-in-from-bottom-8 fade-in duration-500">

                    {/* Visual Hero Area */}
                    <div className="md:w-1/2 p-8 md:p-12 bg-gray-50 flex items-center justify-center border-b md:border-b-0 md:border-r border-gray-100">
                        {scannedProduct.image ? (
                            <img
                                src={scannedProduct.image}
                                alt={scannedProduct.name}
                                className="w-full h-auto max-h-[400px] object-contain drop-shadow-2xl"
                            />
                        ) : (
                            <div className="w-full aspect-square bg-white rounded-[2rem] border-2 border-dashed border-gray-200 flex flex-col items-center justify-center text-gray-300">
                                <ImageOff size={100} strokeWidth={1} />
                                <span className="text-sm font-bold uppercase mt-4 opacity-50">Sin Imagen</span>
                            </div>
                        )}
                    </div>

                    {/* Details Content Area */}
                    <div className="md:w-1/2 flex flex-col">
                        <div className="p-8 md:p-12 flex-1">
                            <div className="flex items-center gap-2 mb-4">
                                <CheckCircle2 className="text-emerald-500" size={24} />
                                <span className="text-emerald-600 font-black text-sm uppercase tracking-widest">Encontrado</span>
                            </div>

                            <h2 className="text-4xl font-black text-gray-900 mb-6 leading-[1.1] line-clamp-2">
                                {scannedProduct.name}
                            </h2>

                            <div className="mb-10">
                                <div className="text-7xl md:text-8xl font-black text-blue-600 tracking-tighter flex items-start">
                                    <span className="text-3xl mt-2 mr-1 opacity-50 font-bold">$</span>
                                    {scannedProduct.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </div>
                                <p className="text-gray-400 font-bold text-sm uppercase mt-2 tracking-widest">Precio Unitario</p>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
                                <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                                    <div className="flex items-center gap-2 text-gray-400 font-bold text-[10px] uppercase tracking-wider mb-1">
                                        <Tag size={12} /> Categoría
                                    </div>
                                    <div className="text-gray-800 font-black text-base truncate">{scannedProduct.category}</div>
                                </div>
                                <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                                    <div className="flex items-center gap-2 text-gray-400 font-bold text-[10px] uppercase tracking-wider mb-1">
                                        <BarcodeIcon size={12} /> Código
                                    </div>
                                    <div className="text-gray-800 font-black text-base truncate font-mono">{scannedProduct.barcode || scannedProduct.id}</div>
                                </div>
                                <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 sm:col-span-2">
                                    <div className="flex items-center gap-2 text-gray-400 font-bold text-[10px] uppercase tracking-wider mb-1">
                                        <Box size={12} /> Stock Disponible
                                    </div>
                                    <div className={`text-base font-black flex items-center gap-2 ${scannedProduct.stock > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                        {scannedProduct.stock > 0 ? `Disponible (${scannedProduct.stock})` : 'Agotado Temporalmente'}
                                    </div>
                                </div>
                            </div>

                            {/* Related Offers Section - UX Hook */}
                            <div className="p-5 bg-gradient-to-r from-blue-600 to-indigo-700 rounded-3xl text-white shadow-xl shadow-blue-500/20">
                                <div className="flex items-center gap-2 mb-2">
                                    <Sparkles size={18} className="text-yellow-300 fill-yellow-300" />
                                    <span className="text-xs font-black uppercase tracking-widest">Oferta Relacionada</span>
                                </div>
                                <p className="font-bold text-sm leading-relaxed mb-3">
                                    ¡Aprovecha hoy! Obtén un <span className="text-yellow-300 text-lg mx-1">15% OFF</span> en protectores y accesorios para este artículo.
                                </p>
                                <div className="h-1 bg-white/20 rounded-full overflow-hidden">
                                    <div className="h-full bg-yellow-300 w-1/3" />
                                </div>
                            </div>

                        </div>
                    </div>
                </div>
            )}

            {/* 3. ERROR VIEW (NOT FOUND) */}
            {notFound && (
                <div className="flex flex-col items-center text-center max-w-xl animate-in zoom-in-95 fade-in duration-500">
                    <div className="w-40 h-40 bg-red-50 rounded-[3rem] flex items-center justify-center mb-8 border border-red-100">
                        <AlertCircle size={80} className="text-red-500" strokeWidth={1.5} />
                    </div>
                    <h2 className="text-5xl font-black text-gray-900 mb-4 tracking-tighter">
                        Código No Válido
                    </h2>
                    <p className="text-xl text-gray-400 font-medium leading-relaxed mb-10">
                        El código escaneado no coincide con ningún producto. Intenta de nuevo o solicita ayuda.
                    </p>
                    <button
                        onClick={handleClear}
                        className="px-10 py-4 bg-gray-900 text-white rounded-2xl font-bold hover:bg-black transition-colors"
                    >
                        Reintentar
                    </button>
                </div>
            )}

            {/* MANUAL INPUT MODAL */}
            {showManualInput && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-gray-900/60 backdrop-blur-md animate-in fade-in duration-300">
                    <div className="bg-white w-full max-w-lg rounded-[2.5rem] p-8 shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-5">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-2xl font-black text-gray-900">Digitar Código</h3>
                            <button onClick={() => setShowManualInput(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-400 hover:text-gray-900">
                                <X size={24} />
                            </button>
                        </div>

                        <form onSubmit={onManualSubmit} className="space-y-6">
                            <div>
                                <label className="block text-[10px] font-black uppercase text-gray-400 tracking-widest mb-2 px-1">Ingresa el código SKU o EAN</label>
                                <input
                                    autoFocus
                                    type="text"
                                    value={manualCode}
                                    onChange={(e) => setManualCode(e.target.value)}
                                    placeholder="Ej: 102938475"
                                    className="w-full px-6 py-5 bg-gray-50 border-2 border-gray-100 rounded-2xl text-2xl font-black text-gray-900 outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 transition-all"
                                />
                            </div>
                            <button
                                type="submit"
                                className="w-full py-5 bg-blue-600 text-white rounded-2xl font-black text-xl shadow-lg shadow-blue-500/30 hover:bg-blue-700 active:scale-[0.98] transition-all"
                            >
                                Buscar Producto
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* AUTO-RESET PROGRESS BAR */}
            {(scannedProduct || notFound) && (
                <div className="absolute bottom-0 left-0 right-0 h-3 bg-gray-100">
                    <div
                        key={resetKey}
                        className="h-full bg-blue-600 origin-left"
                        style={{
                            animation: 'shrink 5s linear forwards'
                        }}
                    />
                </div>
            )}

            <style>{`
        @keyframes shrink {
          from { transform: scaleX(1); }
          to { transform: scaleX(0); }
        }
      `}</style>
        </div>
    );
};

export default PriceCheckerDisplay;
