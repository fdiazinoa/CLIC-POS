/**
 * PriceCheckerDisplay
 * 
 * Simple, passive price display for price checker terminals.
 * Shows product info after scan, auto-resets after timeout.
 */

import React, { useState, useEffect } from 'react';
import { Tag, Check, AlertCircle } from 'lucide-react';
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

    // Auto-reset after 5 seconds
    useEffect(() => {
        if (scannedProduct || notFound) {
            const timer = setTimeout(() => {
                setScannedProduct(null);
                setNotFound(false);
                setScanInput('');
            }, 5000);

            return () => clearTimeout(timer);
        }
    }, [scannedProduct, notFound]);

    // Handle barcode input
    const handleScan = (barcode: string) => {
        const product = products.find(p => p.barcode === barcode || p.id === barcode);

        if (product) {
            setScannedProduct(product);
            setNotFound(false);
            onScan?.(barcode);
        } else {
            setNotFound(true);
            setScannedProduct(null);
        }
    };

    // Handle keyboard input (simulated scanner)
    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && scanInput.trim()) {
            handleScan(scanInput.trim());
        }
    };

    return (
        <div className="w-full h-full flex flex-col items-center justify-center p-8">
            {/* Idle State */}
            {!scannedProduct && !notFound && (
                <div className="text-center animate-in fade-in">
                    <div className="text-9xl mb-8 animate-pulse">📷</div>
                    <h2 className="text-5xl font-black text-gray-800 mb-6">
                        Escanea el Producto
                    </h2>
                    <p className="text-2xl text-gray-500 mb-12">
                        Pasa el código de barras por el lector
                    </p>

                    {/* Hidden input for scanner */}
                    <input
                        type="text"
                        value={scanInput}
                        onChange={(e) => setScanInput(e.target.value)}
                        onKeyPress={handleKeyPress}
                        className="w-96 px-6 py-4 bg-gray-100 border-2 border-gray-300 rounded-2xl text-xl font-mono text-center outline-none focus:ring-4 focus:ring-blue-300"
                        placeholder="O ingresa el código aquí..."
                        autoFocus
                    />
                </div>
            )}

            {/* Product Found */}
            {scannedProduct && (
                <div className="text-center animate-in zoom-in-95 fade-in w-full max-w-4xl">
                    {/* Success Icon */}
                    <div className="mb-8">
                        <div className="inline-flex items-center justify-center w-32 h-32 bg-green-500 rounded-full shadow-2xl">
                            <Check size={80} className="text-white" strokeWidth={3} />
                        </div>
                    </div>

                    {/* Product Name */}
                    <h2 className="text-6xl font-black text-gray-900 mb-8 px-8">
                        {scannedProduct.name}
                    </h2>

                    {/* Price Display */}
                    <div className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white p-12 rounded-3xl shadow-2xl mb-8">
                        <div className="text-8xl font-black mb-4">
                            ${scannedProduct.price.toFixed(2)}
                        </div>
                        <div className="text-3xl font-bold opacity-90">
                            Precio Regular
                        </div>
                    </div>

                    {/* Additional Info */}
                    <div className="grid grid-cols-3 gap-6 mb-8">
                        <div className="bg-white p-6 rounded-2xl shadow-md">
                            <div className="text-gray-500 text-lg mb-2">Categoría</div>
                            <div className="text-2xl font-bold text-gray-800">{scannedProduct.category}</div>
                        </div>

                        <div className="bg-white p-6 rounded-2xl shadow-md">
                            <div className="text-gray-500 text-lg mb-2">Código</div>
                            <div className="text-2xl font-bold text-gray-800 font-mono">{scannedProduct.barcode || 'N/A'}</div>
                        </div>

                        <div className="bg-white p-6 rounded-2xl shadow-md">
                            <div className="text-gray-500 text-lg mb-2">Stock</div>
                            <div className="text-2xl font-bold text-gray-800">
                                {scannedProduct.stock > 0 ? (
                                    <span className="text-green-600">✓ Disponible</span>
                                ) : (
                                    <span className="text-red-600">✗ Agotado</span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Promotions (if any) */}
                    {/* TODO: Add discount field to Product type or remove this section
          {scannedProduct.discount && scannedProduct.discount > 0 && (
            <div className="bg-orange-500 text-white p-8 rounded-2xl shadow-xl animate-in slide-in-from-bottom">
              <div className="flex items-center justify-center gap-4 mb-4">
                <Tag size={48} strokeWidth={2.5} />
                <span className="text-4xl font-black">¡OFERTA!</span>
              </div>
              <div className="text-5xl font-black">
                {scannedProduct.discount}% de Descuento
              </div>
              <div className="text-2xl font-bold mt-4 opacity-90">
                Precio Final: ${(scannedProduct.price * (1 - scannedProduct.discount / 100)).toFixed(2)}
              </div>
            </div>
          )}
          */}
                </div>
            )}

            {/* Product Not Found */}
            {notFound && (
                <div className="text-center animate-in zoom-in-95 fade-in">
                    <div className="mb-8">
                        <div className="inline-flex items-center justify-center w-32 h-32 bg-red-500 rounded-full shadow-2xl">
                            <AlertCircle size={80} className="text-white" strokeWidth={3} />
                        </div>
                    </div>

                    <h2 className="text-6xl font-black text-gray-900 mb-6">
                        Producto No Encontrado
                    </h2>

                    <p className="text-3xl text-gray-600 mb-8">
                        El código escaneado no está en nuestro sistema
                    </p>

                    <div className="bg-gray-100 p-8 rounded-2xl inline-block">
                        <p className="text-xl text-gray-500">
                            Por favor, verifica el código o consulta con un empleado
                        </p>
                    </div>
                </div>
            )}

            {/* Auto-reset indicator */}
            {(scannedProduct || notFound) && (
                <div className="absolute bottom-8 left-0 right-0 text-center">
                    <div className="inline-flex items-center gap-3 bg-white/90 backdrop-blur-sm px-8 py-4 rounded-full shadow-lg">
                        <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse" />
                        <span className="text-lg font-bold text-gray-600">
                            Se reiniciará automáticamente...
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PriceCheckerDisplay;
