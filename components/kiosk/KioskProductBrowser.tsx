/**
 * KioskProductBrowser
 * 
 * Product scanning and browsing interface for self-checkout.
 * Large, touch-friendly interface with visual feedback.
 */

import React, { useState, useRef, useEffect } from 'react';
import { Search, ShoppingCart, Plus, Trash2, X, Scale, Minus, ChevronRight, Tag } from 'lucide-react';
import { Product, CartItem, BusinessConfig } from '../../types';
import { hasProductPromotion } from '../../utils/promotionEngine';
import PromoBottomSheet from '../PromoBottomSheet';

interface KioskProductBrowserProps {
    products: Product[];
    cart: CartItem[];
    onAddToCart: (product: Product, quantity?: number) => void;
    onRemoveFromCart: (productId: string) => void;
    onCheckout: () => void;
    onCancel: () => void;
    config: BusinessConfig;
}

const KioskProductBrowser: React.FC<KioskProductBrowserProps> = ({
    products,
    cart,
    onAddToCart,
    onRemoveFromCart,
    onCheckout,
    onCancel,
    config
}) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [lastScanned, setLastScanned] = useState<string | null>(null);
    const [selectedCategory, setSelectedCategory] = useState<string>('Todos');

    // Promo Sheet State
    const [showPromoSheet, setShowPromoSheet] = useState(false);
    const [selectedPromoProduct, setSelectedPromoProduct] = useState<Product | null>(null);

    // Weighted Product Logic
    const [weightModalOpen, setWeightModalOpen] = useState(false);
    const [weighingProduct, setWeighingProduct] = useState<Product | null>(null);
    const [currentWeight, setCurrentWeight] = useState(0);
    const [isWeighing, setIsWeighing] = useState(false);

    const cartContainerRef = useRef<HTMLDivElement>(null);
    const cartEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom when cart changes (new item added)
    useEffect(() => {
        // Small timeout to ensure DOM is updated
        setTimeout(() => {
            cartEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }, 100);
    }, [cart.length]);

    // Simulate weighing process
    useEffect(() => {
        if (weightModalOpen && weighingProduct) {
            setIsWeighing(true);
            setCurrentWeight(0);

            // Animate weight numbers
            const interval = setInterval(() => {
                setCurrentWeight(prev => prev + (Math.random() * 0.5));
            }, 100);

            // Finalize weight after 2.5s
            const timeout = setTimeout(() => {
                clearInterval(interval);
                const finalWeight = Number((Math.random() * 2 + 0.5).toFixed(3)); // Random weight between 0.5 and 2.5kg
                setCurrentWeight(finalWeight);
                setIsWeighing(false);
            }, 2500);

            return () => {
                clearInterval(interval);
                clearTimeout(timeout);
            };
        }
    }, [weightModalOpen, weighingProduct]);

    // Simulate barcode scan
    const handleScan = (barcode: string) => {
        const product = products.find(p => p.barcode === barcode);
        if (product) {
            handleProductClick(product);
        }
    };

    const handleProductClick = (product: Product) => {
        if (product.type === 'SERVICE') {
            // Open weight modal for weighted items
            setWeighingProduct(product);
            setWeightModalOpen(true);
        } else {
            // Add normal product
            onAddToCart(product);
            setLastScanned(product.name);
            setTimeout(() => setLastScanned(null), 2000);
        }
    };

    const confirmWeight = () => {
        if (weighingProduct) {
            onAddToCart(weighingProduct, currentWeight);
            setLastScanned(`${weighingProduct.name} (${currentWeight}kg)`);
            setWeightModalOpen(false);
            setWeighingProduct(null);
            setTimeout(() => setLastScanned(null), 2000);
        }
    };

    // Extract categories
    const categories = ['Todos', ...Array.from(new Set(products.map(p => p.category)))];

    // Filter products by search and category
    const filteredProducts = products.filter(p => {
        const matchesSearch = (p.name || '').toLowerCase().includes(searchQuery.toLowerCase()) || p.barcode?.includes(searchQuery);
        const matchesCategory = selectedCategory === 'Todos' || p.category === selectedCategory;
        return matchesSearch && matchesCategory;
    });

    // Calculate totals
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

    return (
        <div className="fixed inset-0 w-screen h-screen flex bg-gray-50 overflow-hidden">
            {/* Main Shopping Area */}
            <div className="flex-1 flex flex-col h-full overflow-hidden">
                {/* Header with Search and Categories */}
                <div className="bg-white shadow-sm z-10 flex-shrink-0">
                    <div className="p-6 border-b border-gray-100">
                        <div className="flex items-center gap-4">
                            {/* Search Bar */}
                            <div className="flex-1 relative">
                                <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-400" size={24} />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Buscar producto..."
                                    className="w-full pl-14 pr-6 py-4 bg-gray-100 border-transparent focus:bg-white border-2 focus:border-blue-500 rounded-2xl text-lg font-medium outline-none transition-all"
                                />
                            </div>

                            {/* Cancel Button */}
                            <button
                                onClick={onCancel}
                                className="px-6 py-4 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-2xl font-bold transition-all flex items-center gap-2"
                            >
                                <X size={20} />
                                Salir
                            </button>
                        </div>
                    </div>

                    {/* Category Pills */}
                    <div className="px-6 py-4 overflow-x-auto flex gap-3 pb-6 no-scrollbar">
                        {categories.map(cat => (
                            <button
                                key={cat}
                                onClick={() => setSelectedCategory(cat)}
                                className={`px-6 py-3 rounded-full font-bold whitespace-nowrap transition-all ${selectedCategory === cat
                                    ? 'bg-blue-600 text-white shadow-lg scale-105'
                                    : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                                    }`}
                            >
                                {cat}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Scan Feedback */}
                {lastScanned && (
                    <div className="bg-green-500 text-white px-6 py-4 text-center animate-in slide-in-from-top flex-shrink-0">
                        <p className="text-xl font-bold">✓ Producto agregado: {lastScanned}</p>
                    </div>
                )}

                {/* Product Grid */}
                <div className="flex-1 overflow-y-auto p-6">
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 pb-20">
                        {filteredProducts.slice(0, 20).map(product => (
                            <button
                                key={product.id}
                                onClick={() => handleProductClick(product)}
                                className="bg-white rounded-2xl shadow-sm hover:shadow-xl transition-all transform hover:-translate-y-1 overflow-hidden group text-left flex flex-col h-full"
                            >
                                {/* Product Image - Unified Container */}
                                <div className="w-full aspect-square bg-white p-4 flex items-center justify-center border-b border-gray-50 relative">
                                    {product.type === 'SERVICE' && (
                                        <div className="absolute top-3 right-3 bg-orange-100 text-orange-700 p-2 rounded-full z-10">
                                            <Scale size={16} />
                                        </div>
                                    )}
                                    {product.image || product.images?.[0] ? (
                                        <img
                                            src={product.image || product.images?.[0]}
                                            alt={product.name}
                                            className="w-full h-full object-contain group-hover:scale-110 transition-transform duration-300"
                                            onError={(e) => {
                                                e.currentTarget.style.display = 'none';
                                                e.currentTarget.parentElement!.innerHTML = `<span class="text-6xl">${product.category === 'Bebidas' ? '🥤' : '📦'}</span>`;
                                            }}
                                        />
                                    ) : (
                                        <span className="text-6xl">
                                            {product.category === 'Bebidas' ? '🥤' : '📦'}
                                        </span>
                                    )}

                                    {/* PROMO BADGE (Kiosk) */}
                                    {hasProductPromotion(product, config) && (
                                        <div
                                            className="absolute top-0 right-0 cursor-pointer z-20"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setSelectedPromoProduct(product);
                                                setShowPromoSheet(true);
                                            }}
                                        >
                                            <div className="bg-red-500 text-white text-xs font-black px-3 py-1.5 rounded-bl-2xl shadow-md flex items-center gap-1.5 animate-in slide-in-from-top-2 hover:bg-red-600 transition-colors">
                                                <Tag size={12} className="fill-white" />
                                                <span>OFERTA</span>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Product Info */}
                                <div className="p-5 flex-1 flex flex-col">
                                    <h3 className="font-bold text-gray-800 mb-1 line-clamp-2 leading-tight">
                                        {product.name}
                                    </h3>
                                    <p className="text-sm text-gray-400 mb-3">{product.category}</p>

                                    <div className="mt-auto flex items-center justify-between">
                                        <div className="text-2xl font-black text-gray-900">
                                            ${product.price.toFixed(2)}
                                            <span className="text-xs font-normal text-gray-400 ml-1">
                                                {product.type === 'SERVICE' ? '/kg' : ''}
                                            </span>
                                        </div>
                                        <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors">
                                            <Plus size={24} />
                                        </div>
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>

                    {filteredProducts.length === 0 && (
                        <div className="text-center py-20">
                            <div className="text-6xl mb-4">🔍</div>
                            <p className="text-2xl font-bold text-gray-400">No se encontraron productos</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Cart Sidebar */}
            <div className="w-96 bg-white border-l-2 border-gray-200 flex flex-col shadow-2xl flex-shrink-0 h-full z-20">
                {/* Cart Header */}
                <div className="bg-blue-600 text-white p-6">
                    <div className="flex items-center gap-3 mb-2">
                        <ShoppingCart size={32} strokeWidth={2.5} />
                        <h2 className="text-2xl font-black">Tu Carrito</h2>
                    </div>
                    <p className="text-blue-100 text-lg">
                        {itemCount} {itemCount === 1 ? 'producto' : 'productos'}
                    </p>
                </div>

                {/* Cart Items */}
                <div
                    ref={cartContainerRef}
                    className="flex-1 overflow-y-auto p-4 scroll-smooth"
                >
                    {cart.length === 0 ? (
                        <div className="text-center py-20">
                            <div className="text-6xl mb-4">🛒</div>
                            <p className="text-lg font-bold text-gray-400">Carrito vacío</p>
                            <p className="text-sm text-gray-400 mt-2">Agrega productos para comenzar</p>
                        </div>
                    ) : (
                        <div className="flex flex-col">
                            {cart.map((item, index) => (
                                <div
                                    key={item.id}
                                    className={`py-4 flex justify-between items-start group ${index !== cart.length - 1 ? 'border-b border-dashed border-gray-200' : ''}`}
                                >
                                    {/* Left Side: Info */}
                                    <div className="flex-1 pr-2">
                                        <h4 className="font-bold text-gray-800 text-lg leading-tight mb-1">{item.name}</h4>
                                        <div className="text-sm text-gray-500 font-medium">
                                            {item.quantity} x ${(item.originalPrice || item.price).toFixed(2)}
                                        </div>
                                        {item.price < (item.originalPrice || item.price) && (
                                            <div className="mt-1">
                                                <span className="bg-green-100 text-green-700 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                                                    Oferta Aplicada
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Right Side: Price & Actions */}
                                    <div className="flex flex-col items-end gap-2">
                                        <div className="flex flex-col items-end">
                                            {item.price < (item.originalPrice || item.price) && (
                                                <span className="text-xs text-gray-400 line-through">
                                                    ${((item.originalPrice || item.price) * item.quantity).toFixed(2)}
                                                </span>
                                            )}
                                            <span className={`text-xl font-black ${item.price < (item.originalPrice || item.price) ? 'text-green-600' : 'text-gray-800'}`}>
                                                ${(item.price * item.quantity).toFixed(2)}
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-3 bg-gray-100 rounded-lg p-1">
                                            <button
                                                onClick={() => onAddToCart(item, -1)} // Remove 1
                                                className="p-2 hover:bg-white rounded-md text-gray-600 transition-all shadow-sm disabled:opacity-50"
                                                disabled={item.quantity <= 0}
                                            >
                                                <Minus size={16} />
                                            </button>
                                            <span className="font-bold w-4 text-center text-sm">{item.quantity}</span>
                                            <button
                                                onClick={() => onAddToCart(item, 1)} // Add 1
                                                className="p-2 hover:bg-white rounded-md text-blue-600 transition-all shadow-sm"
                                            >
                                                <Plus size={16} />
                                            </button>
                                        </div>

                                        <button
                                            onClick={() => onRemoveFromCart(item.id)}
                                            className="text-gray-300 hover:text-red-500 p-1 transition-colors"
                                            title="Eliminar todo"
                                        >
                                            <X size={16} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                            <div ref={cartEndRef} className="h-4" />
                        </div>
                    )}
                </div>

                {/* Cart Footer */}
                <div className="border-t-2 border-gray-200 p-6 space-y-4">
                    {/* Subtotal */}
                    <div className="flex items-center justify-between text-2xl">
                        <span className="font-bold text-gray-700">Subtotal:</span>
                        <span className="font-black text-gray-900">${subtotal.toFixed(2)}</span>
                    </div>

                    {/* Checkout Button */}
                    <button
                        onClick={onCheckout}
                        disabled={cart.length === 0}
                        className="w-full py-6 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-2xl font-black text-2xl shadow-lg hover:shadow-xl transition-all transform hover:scale-105 active:scale-95 disabled:transform-none"
                    >
                        Ir a Pagar
                    </button>
                </div>
            </div>


            {/* Weight Scale Modal */}
            {
                weightModalOpen && weighingProduct && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
                        <div className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl transform transition-all scale-100">
                            <div className="text-center">
                                <div className="w-24 h-24 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6">
                                    <Scale size={48} className="text-blue-600" />
                                </div>

                                <h3 className="text-2xl font-black text-gray-800 mb-2">
                                    {isWeighing ? 'Pesando producto...' : 'Peso Confirmado'}
                                </h3>
                                <p className="text-gray-500 mb-8">
                                    {weighingProduct.name}
                                </p>

                                <div className="bg-gray-50 rounded-2xl p-8 mb-8 border-2 border-gray-100">
                                    <div className="text-6xl font-black text-gray-900 font-mono tracking-tighter">
                                        {currentWeight.toFixed(3)}
                                        <span className="text-2xl text-gray-400 ml-2">kg</span>
                                    </div>
                                    <div className="mt-2 text-blue-600 font-bold">
                                        Total: ${(currentWeight * weighingProduct.price).toFixed(2)}
                                    </div>
                                </div>

                                <div className="flex gap-4">
                                    <button
                                        onClick={() => setWeightModalOpen(false)}
                                        className="flex-1 py-4 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition-colors"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        onClick={confirmWeight}
                                        disabled={isWeighing}
                                        className="flex-1 py-4 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                    >
                                        {isWeighing ? (
                                            <span className="animate-pulse">Calculando...</span>
                                        ) : (
                                            <>
                                                Confirmar
                                                <ChevronRight size={20} />
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            <PromoBottomSheet
                isOpen={showPromoSheet}
                onClose={() => setShowPromoSheet(false)}
                product={selectedPromoProduct}
                onAddToCart={(p) => handleProductClick(p)}
                config={config}
            />
        </div >
    );
};

export default KioskProductBrowser;
