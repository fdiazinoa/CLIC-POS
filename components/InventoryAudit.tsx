
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  X, ScanBarcode, Search, Check, AlertTriangle, 
  Save, RefreshCw, Plus, Minus, Camera, Zap 
} from 'lucide-react';
import { Product } from '../types';

interface InventoryAuditProps {
  products: Product[];
  onClose: () => void;
  onCommit: (adjustments: { productId: string; newStock: number }[]) => void;
}

interface AuditItem {
  product: Product;
  systemStock: number;
  countedStock: number;
  lastScannedAt: number; // Timestamp for highlighting
}

const InventoryAudit: React.FC<InventoryAuditProps> = ({ products, onClose, onCommit }) => {
  // --- STATE ---
  const [auditItems, setAuditItems] = useState<AuditItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCameraActive, setIsCameraActive] = useState(true);
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null);
  
  // Audio refs for feedback
  const successBeep = useRef<HTMLAudioElement | null>(null);
  const errorBeep = useRef<HTMLAudioElement | null>(null);

  // Focus ref for continuous scanning
  const inputRef = useRef<HTMLInputElement>(null);

  // --- INITIALIZATION ---
  useEffect(() => {
    // Initialize audio (using generic beep urls or creating context if needed)
    // For demo purposes we just log, but in prod we'd use real Audio objects
  }, []);

  // Ensure input stays focused for barcode scanners
  useEffect(() => {
    const focusInterval = setInterval(() => {
      if (!document.activeElement || document.activeElement.tagName !== 'INPUT') {
        inputRef.current?.focus();
      }
    }, 2000);
    return () => clearInterval(focusInterval);
  }, []);

  // --- HANDLERS ---

  const handleScan = (code: string) => {
    // 1. Find Product
    const product = products.find(p => 
      p.barcode === code || 
      p.id === code || 
      // Check variants if available since 'sku' is on ProductVariant, not Product
      p.variants?.some(v => v.sku.toLowerCase() === code.toLowerCase())
    );

    if (!product) {
      // Error Feedback
      setLastScannedCode(`Desconocido: ${code}`);
      return;
    }

    // 2. Update Audit List
    setAuditItems(prev => {
      const existingIdx = prev.findIndex(item => item.product.id === product.id);
      
      if (existingIdx >= 0) {
        // Increment existing
        const newItems = [...prev];
        newItems[existingIdx] = {
          ...newItems[existingIdx],
          countedStock: newItems[existingIdx].countedStock + 1,
          lastScannedAt: Date.now()
        };
        // Move to top
        const item = newItems.splice(existingIdx, 1)[0];
        return [item, ...newItems];
      } else {
        // Add new
        return [{
          product,
          systemStock: product.stock || 0,
          countedStock: 1,
          lastScannedAt: Date.now()
        }, ...prev];
      }
    });

    setLastScannedCode(product.name);
    setSearchQuery(''); // Clear input for next scan
  };

  const handleManualCountChange = (productId: string, delta: number) => {
    setAuditItems(prev => prev.map(item => {
      if (item.product.id === productId) {
        return { ...item, countedStock: Math.max(0, item.countedStock + delta) };
      }
      return item;
    }));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (searchQuery.trim()) {
        handleScan(searchQuery.trim());
      }
    }
  };

  const handleFinalize = () => {
    if (auditItems.length === 0) {
      onClose();
      return;
    }

    if (confirm(`¿Ajustar stock de ${auditItems.length} productos? Esta acción actualizará el inventario.`)) {
      const adjustments = auditItems.map(item => ({
        productId: item.product.id,
        newStock: item.countedStock
      }));
      onCommit(adjustments);
    }
  };

  // --- RENDER HELPERS ---

  const getStatusColor = (item: AuditItem) => {
    const diff = item.countedStock - item.systemStock;
    if (diff === 0) return 'border-emerald-500 bg-emerald-50'; // Match
    if (diff < 0) return 'border-red-400 bg-red-50'; // Missing stock
    return 'border-blue-400 bg-blue-50'; // Surplus
  };

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900 flex flex-col md:flex-row h-screen w-screen overflow-hidden animate-in fade-in duration-200">
      
      {/* === LEFT: SCANNER VIEW (Active Area) === */}
      <div className="w-full md:w-1/3 bg-black relative flex flex-col border-r border-slate-700">
        
        {/* Header */}
        <div className="absolute top-0 left-0 right-0 p-4 z-20 flex justify-between items-start bg-gradient-to-b from-black/80 to-transparent">
          <div>
            <h2 className="text-white font-bold text-lg flex items-center gap-2">
              <ScanBarcode className="text-blue-400" /> Modo Auditoría
            </h2>
            <p className="text-slate-400 text-xs">Escanea productos uno a uno</p>
          </div>
          <button onClick={onClose} className="p-2 bg-white/10 rounded-full text-white hover:bg-white/20">
            <X size={20} />
          </button>
        </div>

        {/* Camera Simulation Area */}
        <div className="flex-1 relative flex items-center justify-center overflow-hidden">
          {isCameraActive ? (
            <>
              {/* Fake Camera Feed Background */}
              <div className="absolute inset-0 bg-slate-800 opacity-50 animate-pulse"></div>
              
              {/* Viewfinder */}
              <div className="relative z-10 w-64 h-64 border-2 border-blue-500/50 rounded-3xl flex flex-col items-center justify-center shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
                <div className="w-full h-0.5 bg-red-500/80 absolute top-1/2 shadow-[0_0_10px_rgba(239,68,68,0.8)] animate-[scan_2s_ease-in-out_infinite]"></div>
                <p className="mt-32 text-blue-200 font-mono text-xs opacity-80">Apunta al código</p>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center text-slate-500">
              <Camera size={48} className="mb-2 opacity-50" />
              <p>Cámara Pausada</p>
            </div>
          )}
        </div>

        {/* Manual Input Area (Bottom) */}
        <div className="p-4 bg-slate-900 border-t border-slate-800 pb-8">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <input 
              ref={inputRef}
              type="text" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Escanear o escribir código..." 
              className="w-full pl-12 pr-4 py-4 bg-slate-800 text-white rounded-2xl border-2 border-slate-700 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 outline-none font-mono text-lg"
              autoFocus
            />
            {searchQuery && (
              <button 
                onClick={() => handleScan(searchQuery)}
                className="absolute right-2 top-1/2 -translate-y-1/2 bg-blue-600 text-white p-2 rounded-xl"
              >
                <Zap size={20} className="fill-current" />
              </button>
            )}
          </div>
          <div className="flex justify-between items-center mt-3 px-2">
             <span className="text-xs text-slate-500">
                {lastScannedCode ? `Último: ${lastScannedCode}` : 'Listo para escanear'}
             </span>
             <button onClick={() => setIsCameraActive(!isCameraActive)} className="text-xs text-blue-400 hover:text-blue-300 font-bold">
                {isCameraActive ? 'Pausar Cámara' : 'Activar Cámara'}
             </button>
          </div>
        </div>
      </div>

      {/* === RIGHT: LIST VIEW (Results) === */}
      <div className="w-full md:w-2/3 bg-slate-100 flex flex-col h-full">
        
        {/* Stats Header */}
        <div className="bg-white p-4 shadow-sm border-b border-slate-200 flex items-center justify-between z-10">
           <div className="flex gap-6">
              <div>
                 <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Items Contados</p>
                 <p className="text-2xl font-black text-slate-800">{auditItems.length}</p>
              </div>
              <div>
                 <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Unidades Totales</p>
                 <p className="text-2xl font-black text-blue-600">{auditItems.reduce((acc, i) => acc + i.countedStock, 0)}</p>
              </div>
              <div className="hidden lg:block">
                 <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Discrepancia</p>
                 <p className="text-2xl font-black text-orange-500">
                    {auditItems.reduce((acc, i) => acc + (i.countedStock - i.systemStock), 0) > 0 ? '+' : ''}
                    {auditItems.reduce((acc, i) => acc + (i.countedStock - i.systemStock), 0)}
                 </p>
              </div>
           </div>

           <button 
             onClick={handleFinalize}
             className="px-6 py-3 bg-gray-900 text-white rounded-xl font-bold shadow-lg hover:bg-gray-800 hover:scale-[1.02] active:scale-95 transition-all flex items-center gap-2"
           >
              <Save size={20} />
              <span className="hidden sm:inline">Ajustar Stock</span>
           </button>
        </div>

        {/* Scrollable List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
           {auditItems.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 opacity-60">
                 <RefreshCw size={64} className="mb-4" />
                 <p className="text-xl font-medium">Esperando escaneo...</p>
                 <p className="text-sm">Escanea un producto para comenzar el recuento.</p>
              </div>
           ) : (
              auditItems.map((item) => {
                 const diff = item.countedStock - item.systemStock;
                 const isRecent = Date.now() - item.lastScannedAt < 2000;

                 return (
                    <div 
                       key={item.product.id} 
                       className={`relative bg-white rounded-2xl p-4 shadow-sm border-2 transition-all duration-300 flex flex-col sm:flex-row gap-4 items-center ${getStatusColor(item)} ${isRecent ? 'scale-[1.02] shadow-lg ring-2 ring-blue-400' : ''}`}
                    >
                       {/* Image */}
                       <div className="w-16 h-16 bg-white rounded-xl overflow-hidden shrink-0 border border-slate-100">
                          <img src={item.product.image} alt={item.product.name} className="w-full h-full object-cover" />
                       </div>

                       {/* Details */}
                       <div className="flex-1 min-w-0 text-center sm:text-left">
                          <h4 className="font-bold text-slate-800 text-lg leading-tight truncate">{item.product.name}</h4>
                          <div className="flex items-center justify-center sm:justify-start gap-3 mt-1 text-sm">
                             <span className="text-slate-500 font-mono bg-white/50 px-1.5 rounded">{item.product.barcode || 'NO-CODE'}</span>
                             <span className="text-slate-400 flex items-center gap-1">
                                Teórico: <strong>{item.systemStock}</strong>
                             </span>
                          </div>
                       </div>

                       {/* Counter Control */}
                       <div className="flex items-center gap-3 bg-white rounded-xl p-1 shadow-sm border border-slate-100">
                          <button 
                             onClick={() => handleManualCountChange(item.product.id, -1)}
                             className="w-10 h-10 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-600 flex items-center justify-center active:scale-90 transition-transform"
                          >
                             <Minus size={20} />
                          </button>
                          <div className="w-16 text-center">
                             <span className="block text-2xl font-black text-slate-800 leading-none">{item.countedStock}</span>
                          </div>
                          <button 
                             onClick={() => handleManualCountChange(item.product.id, 1)}
                             className="w-10 h-10 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 flex items-center justify-center active:scale-90 transition-transform"
                          >
                             <Plus size={20} />
                          </button>
                       </div>

                       {/* Difference Indicator */}
                       <div className={`w-20 text-center shrink-0 ${diff === 0 ? 'opacity-50' : 'opacity-100'}`}>
                          <span className="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">Diferencia</span>
                          <div className={`text-lg font-bold flex items-center justify-center gap-1 ${diff === 0 ? 'text-emerald-600' : (diff < 0 ? 'text-red-600' : 'text-blue-600')}`}>
                             {diff === 0 ? <Check size={18} /> : (diff > 0 ? `+${diff}` : diff)}
                          </div>
                       </div>

                    </div>
                 );
              })
           )}
        </div>

        {/* Tip Footer */}
        <div className="p-3 bg-slate-50 text-center text-xs text-slate-400 border-t border-slate-200">
           Usa tu lector de código de barras o la cámara para añadir items rápidamente.
        </div>

      </div>
    </div>
  );
};

export default InventoryAudit;
