import React, { useMemo, useState } from 'react';
import { ArrowLeft, Camera, Check, Printer, ScanBarcode, Search, Tag } from 'lucide-react';
import { BusinessConfig, Product } from '../../types';
import LabelPrintModal from '../LabelPrintModal';
import BarcodeScannerModal from '../BarcodeScannerModal';

interface InventoryLabelsMobileProps {
  products: Product[];
  config: BusinessConfig;
  terminalId?: string;
  onCancel: () => void;
}

const InventoryLabelsMobile: React.FC<InventoryLabelsMobileProps> = ({
  products,
  config,
  terminalId,
  onCancel
}) => {
  const [search, setSearch] = useState('');
  const [scanInput, setScanInput] = useState('');
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const [showLabelModal, setShowLabelModal] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [copiesByProduct, setCopiesByProduct] = useState<Record<string, number>>({});

  const filteredProducts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return products;

    return products.filter((product) => (
      (product.name || '').toLowerCase().includes(needle) ||
      (product.barcode || '').toLowerCase().includes(needle) ||
      (product.id || '').toLowerCase().includes(needle)
    ));
  }, [products, search]);

  const selectedItems = useMemo(() => {
    return products
      .filter(product => selectedIds.has(product.id))
      .map(product => ({
        productId: product.id,
        productName: product.name,
        sku: product.barcode || product.id,
        price: product.price,
        quantityReceived: Math.max(1, Math.floor(copiesByProduct[product.id] || 1))
      }));
  }, [copiesByProduct, products, selectedIds]);

  const selectedCount = selectedIds.size;

  const updateCopies = (productId: string, delta: number) => {
    setCopiesByProduct(prev => {
      const current = Math.max(1, Math.floor(prev[productId] || 1));
      const next = Math.max(1, current + delta);
      return { ...prev, [productId]: next };
    });
  };

  const toggleSelect = (productId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });

    setCopiesByProduct(prev => ({
      ...prev,
      [productId]: Math.max(1, Math.floor(prev[productId] || 1))
    }));
  };

  const handleScanCode = (code: string) => {
    const clean = code.trim();
    if (!clean) return null;

    return products.find(product => {
      if (product.barcode === clean || product.id === clean) return true;
      return (product.variants || []).some(variant => (variant.barcode || []).includes(clean));
    }) || null;
  };

  const handleManualScan = () => {
    const product = handleScanCode(scanInput);
    if (!product) {
      alert('Producto no encontrado para etiquetas.');
      return;
    }

    setSelectedIds(prev => {
      const next = new Set(prev);
      next.add(product.id);
      return next;
    });

    setCopiesByProduct(prev => ({
      ...prev,
      [product.id]: Math.max(1, Math.floor(prev[product.id] || 1))
    }));

    setScanInput('');
  };

  const handleCameraScan = async (code: string): Promise<{ success: boolean; message?: string }> => {
    const product = handleScanCode(code);
    if (!product) {
      return { success: false, message: 'Producto no encontrado' };
    }

    setSelectedIds(prev => {
      const next = new Set(prev);
      next.add(product.id);
      return next;
    });

    setCopiesByProduct(prev => ({
      ...prev,
      [product.id]: Math.max(1, Math.floor(prev[product.id] || 1))
    }));

    return { success: true, message: `${product.name} seleccionado` };
  };

  return (
    <div className="min-h-full bg-gray-50 pb-24">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 sticky top-0 z-20">
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={onCancel}
            className="min-h-[50px] px-4 rounded-xl border-2 border-gray-200 bg-white text-gray-700 font-black text-sm"
          >
            <span className="inline-flex items-center gap-2">
              <ArrowLeft size={16} /> Volver
            </span>
          </button>

          <button
            onClick={() => setShowLabelModal(true)}
            disabled={selectedCount === 0}
            className="min-h-[50px] px-4 rounded-xl bg-purple-600 text-white font-black text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="inline-flex items-center gap-2">
              <Printer size={16} /> Imprimir ({selectedCount})
            </span>
          </button>
        </div>

        <div className="mt-3">
          <h1 className="text-lg font-black text-gray-900">Imprimir Etiquetas</h1>
          <p className="text-xs font-bold text-gray-500">Selecciona artículos y define copias para impresión móvil.</p>
        </div>

        <div className="mt-3 flex gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar nombre / código..."
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50 outline-none focus:ring-2 focus:ring-purple-200"
            />
          </div>
        </div>

        <div className="mt-2 flex gap-2">
          <div className="flex-1 relative">
            <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleManualScan()}
              placeholder="Escanear producto..."
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 bg-white outline-none focus:ring-2 focus:ring-purple-200"
            />
          </div>
          <button
            onClick={() => setShowCameraScanner(true)}
            className="px-3 rounded-xl bg-purple-100 text-purple-700"
            title="Escanear con cámara"
          >
            <Camera size={20} />
          </button>
          <button
            onClick={handleManualScan}
            className="px-4 rounded-xl bg-purple-600 text-white font-black text-sm"
          >
            Agregar
          </button>
        </div>
      </div>

      <div className="p-4 space-y-2">
        {filteredProducts.map((product) => {
          const isSelected = selectedIds.has(product.id);
          const copies = Math.max(1, Math.floor(copiesByProduct[product.id] || 1));

          return (
            <button
              key={product.id}
              onClick={() => toggleSelect(product.id)}
              className={`w-full rounded-2xl border-2 p-3 text-left transition-all ${isSelected ? 'bg-purple-50 border-purple-300' : 'bg-white border-gray-200'}`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isSelected ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                  {isSelected ? <Check size={18} /> : <Tag size={18} />}
                </div>

                <img
                  src={product.image || 'https://placehold.co/72x72/e2e8f0/64748b?text=SKU'}
                  alt={product.name}
                  className="w-11 h-11 rounded-lg object-cover border border-gray-200"
                />

                <div className="flex-1 min-w-0">
                  <p className="font-black text-gray-900 text-sm truncate">{product.name}</p>
                  <p className="text-[11px] font-bold text-gray-500 truncate">{product.barcode || product.id}</p>
                </div>

                {isSelected && (
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => updateCopies(product.id, -1)}
                      className="w-7 h-7 rounded-md border border-gray-300 bg-white text-gray-700 font-black"
                    >
                      -
                    </button>
                    <span className="min-w-[26px] text-center text-xs font-black text-purple-700">{copies}</span>
                    <button
                      onClick={() => updateCopies(product.id, 1)}
                      className="w-7 h-7 rounded-md bg-purple-600 text-white font-black"
                    >
                      +
                    </button>
                  </div>
                )}
              </div>
            </button>
          );
        })}

        {filteredProducts.length === 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
            <p className="text-sm font-black text-gray-500">No hay productos con ese filtro</p>
          </div>
        )}
      </div>

      <LabelPrintModal
        isOpen={showLabelModal}
        onClose={() => setShowLabelModal(false)}
        config={config}
        terminalId={terminalId}
        items={selectedItems}
        sourceTitle="Inventario Móvil"
        defaultQuantityMode="RECEIVED"
      />

      <BarcodeScannerModal
        isOpen={showCameraScanner}
        onClose={() => setShowCameraScanner(false)}
        onScan={handleCameraScan}
      />
    </div>
  );
};

export default InventoryLabelsMobile;
