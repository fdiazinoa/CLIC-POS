
import React, { useState, useMemo } from 'react';
import { 
  ArrowLeft, Truck, Package, AlertTriangle, Search, Plus, 
  ShoppingCart, Check, X, FileText, Calendar, Archive,
  ClipboardList, ArrowRight, Save, User, Minus, Box,
  ScanBarcode, LayoutList
} from 'lucide-react';
import { BusinessConfig, Product, Supplier, PurchaseOrder, PurchaseOrderItem } from '../types';
import InventoryAudit from './InventoryAudit';

interface SupplyChainManagerProps {
  products: Product[];
  suppliers: Supplier[];
  purchaseOrders: PurchaseOrder[];
  config: BusinessConfig;
  onClose: () => void;
  onCreateOrder: (order: PurchaseOrder) => void;
  onUpdateOrder: (order: PurchaseOrder) => void;
  onReceiveStock: (items: PurchaseOrderItem[]) => void; 
}

type Tab = 'ALERTS' | 'CREATE' | 'RECEIVE' | 'INVENTORY';

const SupplyChainManager: React.FC<SupplyChainManagerProps> = ({ 
  products, 
  suppliers, 
  purchaseOrders,
  config, 
  onClose,
  onCreateOrder,
  onUpdateOrder,
  onReceiveStock
}) => {
  const [activeTab, setActiveTab] = useState<Tab>('CREATE');
  
  // Create Order State
  const [selectedSupplier, setSelectedSupplier] = useState<string>(suppliers[0]?.id || '');
  const [orderCart, setOrderCart] = useState<PurchaseOrderItem[]>([]);
  const [productSearch, setProductSearch] = useState('');

  // Receive Order State
  const [receivingOrderId, setReceivingOrderId] = useState<string | null>(null);

  // Inventory Audit State
  const [isAuditMode, setIsAuditMode] = useState(false);

  // --- DERIVED DATA ---
  const lowStockProducts = useMemo(() => {
    return products.filter(p => 
      p.trackStock && (p.stock || 0) <= (p.minStock || 5)
    );
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter(p => 
      p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
      p.barcode?.includes(productSearch)
    );
  }, [products, productSearch]);

  const activeOrders = useMemo(() => {
    return purchaseOrders.filter(po => po.status === 'ORDERED' || po.status === 'PARTIAL');
  }, [purchaseOrders]);

  // --- HANDLERS ---

  const addToOrderCart = (product: Product) => {
    setOrderCart(prev => {
      const existing = prev.find(i => i.productId === product.id);
      if (existing) {
        return prev.map(i => i.productId === product.id ? { ...i, quantityOrdered: i.quantityOrdered + 1 } : i);
      }
      return [...prev, {
        productId: product.id,
        productName: product.name,
        quantityOrdered: 1,
        quantityReceived: 0,
        cost: product.cost || 0
      }];
    });
  };

  const updateCartQuantity = (productId: string, delta: number) => {
    setOrderCart(prev => prev.map(i => {
      if (i.productId === productId) {
        return { ...i, quantityOrdered: Math.max(1, i.quantityOrdered + delta) };
      }
      return i;
    }));
  };

  const updateCartCost = (productId: string, newCost: number) => {
    setOrderCart(prev => prev.map(i => {
      if (i.productId === productId) {
        return { ...i, cost: isNaN(newCost) ? 0 : newCost };
      }
      return i;
    }));
  };

  const removeFromCart = (productId: string) => {
    setOrderCart(prev => prev.filter(i => i.productId !== productId));
  };

  const handleFinalizeOrder = () => {
    if (!selectedSupplier || orderCart.length === 0) return;
    
    const totalCost = orderCart.reduce((acc, item) => acc + (item.cost * item.quantityOrdered), 0);
    const newOrder: PurchaseOrder = {
      id: `PO-${Date.now().toString().substr(-6)}`,
      supplierId: selectedSupplier,
      date: new Date().toISOString(),
      status: 'ORDERED',
      items: orderCart,
      totalCost
    };

    onCreateOrder(newOrder);
    setOrderCart([]);
    alert("Orden creada exitosamente.");
    setActiveTab('RECEIVE');
  };

  const handleAuditCommit = (adjustments: { productId: string; newStock: number }[]) => {
    // In a real app, this would call an API to create a stock adjustment movement
    // For now, we simulate receiving stock to trigger the update logic in App.tsx 
    // or we should add a specific prop for adjustments. 
    // Reusing onReceiveStock with a hack since App.tsx logic adds, but we need to SET.
    // Ideally, App.tsx should have onUpdateProductStock(id, newStock).
    // Assuming for this demo we just alert or reuse existing props.
    
    // Simulating updates via PurchaseOrderItem interface to piggyback existing handler
    // NOTE: Real implementation needs dedicated stock adjustment handler
    const fakeItems: PurchaseOrderItem[] = adjustments.map(adj => {
       const current = products.find(p => p.id === adj.productId)?.stock || 0;
       const diff = adj.newStock - current;
       return {
          productId: adj.productId,
          productName: 'Audit Adjustment',
          quantityOrdered: 0,
          quantityReceived: diff, // This will ADD diff to current stock in App.tsx handleReceiveStock
          cost: 0
       };
    });
    
    onReceiveStock(fakeItems);
    setIsAuditMode(false);
    alert("Inventario actualizado correctamente.");
  };

  // --- TOUCH FRIENDLY COMPONENTS ---

  const BigStepper = ({ value, onDecrease, onIncrease }: { value: number; onDecrease: () => void; onIncrease: () => void }) => (
     <div className="flex items-center bg-gray-100 rounded-2xl p-1 h-14 w-40">
        <button onClick={onDecrease} className="h-full w-12 flex items-center justify-center bg-white rounded-xl shadow-sm text-gray-600 active:bg-gray-50 active:scale-95 transition-all">
           <Minus size={24} />
        </button>
        <span className="flex-1 text-center font-bold text-xl text-gray-800">{value}</span>
        <button onClick={onIncrease} className="h-full w-12 flex items-center justify-center bg-white rounded-xl shadow-sm text-blue-600 active:bg-gray-50 active:scale-95 transition-all">
           <Plus size={24} />
        </button>
     </div>
  );

  // --- RENDER SECTIONS ---

  const renderAlerts = () => (
    <div className="animate-in fade-in slide-in-from-right-4 pb-20">
      <div className="bg-red-50 border-l-4 border-red-500 rounded-r-xl p-6 mb-6">
        <h3 className="text-xl font-bold text-red-800 flex items-center gap-2">
           <AlertTriangle size={24} /> Alertas de Stock
        </h3>
        <p className="text-red-700 mt-1 text-sm">
           {lowStockProducts.length} productos requieren reabastecimiento urgente.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {lowStockProducts.map(product => (
          <div key={product.id} className="bg-white p-5 rounded-3xl shadow-sm border border-gray-200 flex flex-col justify-between">
            <div>
               <div className="flex justify-between items-start mb-2">
                  <span className="text-xs font-bold text-red-500 bg-red-50 px-3 py-1 rounded-full uppercase">Crítico</span>
                  <span className="text-xs text-gray-400 font-mono">{product.barcode}</span>
               </div>
               <h4 className="font-bold text-gray-800 text-lg leading-tight mb-1">{product.name}</h4>
               <p className="text-sm text-gray-500">{product.category}</p>
            </div>
            
            <div className="flex items-center justify-between mt-6 bg-gray-50 p-3 rounded-2xl">
               <div className="text-center px-2">
                  <p className="text-[10px] uppercase text-gray-400 font-bold">Actual</p>
                  <p className="text-xl font-black text-red-600">{product.stock}</p>
               </div>
               <div className="text-center px-2 border-l border-gray-200">
                  <p className="text-[10px] uppercase text-gray-400 font-bold">Mínimo</p>
                  <p className="text-xl font-black text-gray-700">{product.minStock}</p>
               </div>
               <button 
                  onClick={() => { addToOrderCart(product); setActiveTab('CREATE'); }}
                  className="bg-gray-900 text-white p-3 rounded-xl hover:scale-105 active:scale-95 transition-all shadow-lg"
               >
                  <Plus size={24} />
               </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderInventoryList = () => (
    <div className="animate-in fade-in slide-in-from-right-4 pb-20 flex flex-col h-full">
       <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-gray-800">Inventario Actual</h2>
          <button 
             onClick={() => setIsAuditMode(true)}
             className="px-6 py-3 bg-blue-600 text-white rounded-xl font-bold shadow-lg hover:bg-blue-500 transition-all flex items-center gap-2"
          >
             <ScanBarcode size={20} />
             Hacer Auditoría (Stocktake)
          </button>
       </div>

       <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex-1 flex flex-col">
          <div className="p-4 border-b border-gray-100 bg-gray-50/50">
             <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                <input 
                   type="text" 
                   placeholder="Filtrar inventario..." 
                   value={productSearch}
                   onChange={(e) => setProductSearch(e.target.value)}
                   className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20"
                />
             </div>
          </div>
          
          <div className="flex-1 overflow-y-auto">
             <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                   <tr>
                      <th className="p-4 font-bold text-gray-500">Producto</th>
                      <th className="p-4 font-bold text-gray-500">Categoría</th>
                      <th className="p-4 font-bold text-gray-500 text-center">Stock</th>
                      <th className="p-4 font-bold text-gray-500 text-right">Valor Total</th>
                   </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                   {filteredProducts.map(p => (
                      <tr key={p.id} className="hover:bg-gray-50">
                         <td className="p-4">
                            <div className="font-bold text-gray-800">{p.name}</div>
                            <div className="text-xs text-gray-400 font-mono">{p.barcode || 'N/A'}</div>
                         </td>
                         <td className="p-4 text-gray-600">
                            <span className="px-2 py-1 bg-gray-100 rounded-lg text-xs font-bold">{p.category}</span>
                         </td>
                         <td className="p-4 text-center">
                            <span className={`font-bold ${
                               (p.stock || 0) <= (p.minStock || 0) ? 'text-red-600 bg-red-50 px-2 py-1 rounded' : 'text-gray-800'
                            }`}>
                               {p.stock}
                            </span>
                         </td>
                         <td className="p-4 text-right font-mono text-gray-600">
                            {config.currencySymbol}{((p.stock || 0) * (p.cost || 0)).toFixed(2)}
                         </td>
                      </tr>
                   ))}
                </tbody>
             </table>
          </div>
       </div>
    </div>
  );

  const renderCreateOrder = () => (
    <div className="flex flex-col lg:flex-row gap-6 h-full overflow-hidden animate-in fade-in">
      
      {/* Catalog (Left) */}
      <div className="flex-1 flex flex-col bg-white rounded-3xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100 bg-gray-50/50">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={24} />
            <input 
              type="text" 
              placeholder="Buscar productos..." 
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              className="w-full pl-12 pr-4 py-4 bg-white border border-gray-200 rounded-2xl text-lg outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {filteredProducts.map(p => (
            <div key={p.id} onClick={() => addToOrderCart(p)} className="flex items-center gap-4 p-4 bg-white border border-gray-100 rounded-2xl shadow-sm active:scale-[0.98] transition-transform cursor-pointer">
               <div className="w-16 h-16 bg-gray-100 rounded-xl flex items-center justify-center shrink-0">
                  <Package size={28} className="text-gray-400" />
               </div>
               <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-gray-800 text-lg truncate">{p.name}</h4>
                  <div className="flex gap-4 mt-1 text-sm text-gray-500">
                     <span>Stock: <strong className={p.stock! < p.minStock! ? 'text-red-500' : 'text-gray-700'}>{p.stock}</strong></span>
                     <span>Costo: <strong>{config.currencySymbol}{p.cost?.toFixed(2)}</strong></span>
                  </div>
               </div>
               <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center">
                  <Plus size={24} />
               </div>
            </div>
          ))}
        </div>
      </div>

      {/* Cart (Right) */}
      <div className="w-full lg:w-[450px] flex flex-col bg-white rounded-3xl shadow-xl border border-gray-200 overflow-hidden z-20">
        <div className="p-6 bg-indigo-600 text-white">
           <label className="text-xs font-bold text-indigo-200 uppercase mb-2 block">Proveedor</label>
           <div className="relative">
              <select 
                 value={selectedSupplier}
                 onChange={(e) => setSelectedSupplier(e.target.value)}
                 className="w-full p-4 pl-12 bg-indigo-700 border-none rounded-xl text-white font-bold text-lg appearance-none outline-none focus:ring-2 focus:ring-indigo-400"
              >
                 {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <User className="absolute left-4 top-1/2 -translate-y-1/2 text-indigo-300" size={24} />
           </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
           {orderCart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-400 opacity-60">
                 <ShoppingCart size={64} className="mb-4" />
                 <p className="text-lg font-medium">Carrito de compra vacío</p>
              </div>
           ) : (
              orderCart.map((item) => (
                 <div key={item.productId} className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-col gap-3 animate-in slide-in-from-right-4">
                    <div className="flex justify-between items-start">
                       <h4 className="font-bold text-gray-800 text-lg leading-tight flex-1">{item.productName}</h4>
                       <button onClick={() => removeFromCart(item.productId)} className="p-2 text-gray-300 hover:text-red-500 -mt-2 -mr-2">
                          <X size={24} />
                       </button>
                    </div>
                    <div className="flex items-center justify-between">
                       <div className="flex flex-col">
                          <label className="text-[10px] text-gray-400 font-bold uppercase mb-1">Costo Unitario</label>
                          <div className="flex items-center gap-1 bg-gray-50 rounded-lg px-2 py-1 border border-gray-200 focus-within:border-indigo-400 focus-within:bg-white transition-all">
                             <span className="text-xs text-gray-500 font-bold">{config.currencySymbol}</span>
                             <input 
                                type="number"
                                min="0"
                                step="0.01"
                                value={item.cost}
                                onChange={(e) => updateCartCost(item.productId, parseFloat(e.target.value))}
                                className="w-20 bg-transparent text-sm font-bold text-gray-800 outline-none"
                                placeholder="0.00"
                             />
                          </div>
                       </div>
                       <BigStepper 
                          value={item.quantityOrdered} 
                          onDecrease={() => updateCartQuantity(item.productId, -1)} 
                          onIncrease={() => updateCartQuantity(item.productId, 1)} 
                       />
                    </div>
                    <div className="border-t border-gray-100 pt-2 text-right">
                       <span className="text-xs font-bold text-gray-400 uppercase mr-2">Subtotal</span>
                       <span className="text-lg font-black text-gray-800">{config.currencySymbol}{(item.cost * item.quantityOrdered).toFixed(2)}</span>
                    </div>
                 </div>
              ))
           )}
        </div>

        <div className="p-6 bg-white border-t border-gray-100 shadow-[0_-10px_30px_rgba(0,0,0,0.05)]">
           <div className="flex justify-between items-center mb-6">
              <span className="text-gray-500 font-bold uppercase text-sm">Total Estimado</span>
              <span className="text-3xl font-black text-gray-900">
                 {config.currencySymbol}{orderCart.reduce((acc, i) => acc + (i.cost * i.quantityOrdered), 0).toFixed(2)}
              </span>
           </div>
           <button 
             onClick={handleFinalizeOrder}
             disabled={orderCart.length === 0}
             className="w-full py-5 bg-indigo-600 active:bg-indigo-700 text-white rounded-2xl font-bold text-xl shadow-lg flex items-center justify-center gap-3 transition-transform active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
           >
              <FileText size={24} /> Generar Orden
           </button>
        </div>
      </div>
    </div>
  );

  const renderReception = () => {
    if (receivingOrderId) {
      const order = purchaseOrders.find(o => o.id === receivingOrderId);
      if (!order) return <div>Error: Orden no encontrada</div>;

      const allReceived = order.items.every(i => i.quantityReceived >= i.quantityOrdered);
      const someReceived = order.items.some(i => i.quantityReceived > 0);

      const handleToggleComplete = (itemId: string, current: number, target: number) => {
         // Simple toggle for touch: 0 -> Max -> 0
         const newVal = current >= target ? 0 : target;
         onUpdateOrder({
            ...order,
            items: order.items.map(i => i.productId === itemId ? { ...i, quantityReceived: newVal } : i)
         });
      };

      const confirmReception = () => {
         if (!confirm("¿Confirmar recepción de mercancía y actualizar inventario?")) return;
         onReceiveStock(order.items);
         const finalStatus = allReceived ? 'COMPLETED' : 'PARTIAL';
         onUpdateOrder({ ...order, status: finalStatus });
         setReceivingOrderId(null);
      };

      return (
         <div className="h-full flex flex-col animate-in slide-in-from-right-4">
            {/* Header */}
            <div className="flex items-center gap-4 mb-6 bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
               <button onClick={() => setReceivingOrderId(null)} className="p-3 bg-gray-100 rounded-xl hover:bg-gray-200">
                  <ArrowLeft size={24} />
               </button>
               <div>
                  <h3 className="text-xl font-bold text-gray-800">Recibiendo Orden #{order.id}</h3>
                  <p className="text-sm text-gray-500">{new Date(order.date).toLocaleDateString()}</p>
               </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto space-y-3 pb-20">
               {order.items.map(item => {
                  const isComplete = item.quantityReceived >= item.quantityOrdered;
                  const isPartial = item.quantityReceived > 0 && !isComplete;

                  return (
                     <div 
                        key={item.productId} 
                        onClick={() => handleToggleComplete(item.productId, item.quantityReceived, item.quantityOrdered)}
                        className={`p-5 rounded-2xl border-2 transition-all cursor-pointer flex items-center justify-between ${
                           isComplete 
                              ? 'bg-green-50 border-green-500 shadow-sm' 
                              : isPartial ? 'bg-orange-50 border-orange-300' : 'bg-white border-gray-200'
                        }`}
                     >
                        <div className="flex-1">
                           <h4 className="font-bold text-gray-800 text-lg">{item.productName}</h4>
                           <div className="flex gap-4 mt-2 text-sm font-medium text-gray-500">
                              <span>Solicitado: <strong className="text-gray-800 text-lg">{item.quantityOrdered}</strong></span>
                              <span>Recibido: <strong className={`text-lg ${isComplete ? 'text-green-600' : 'text-orange-500'}`}>{item.quantityReceived}</strong></span>
                           </div>
                        </div>
                        <div className={`w-14 h-14 rounded-full flex items-center justify-center border-4 ${
                           isComplete ? 'bg-green-500 border-green-200 text-white' : 'bg-white border-gray-200 text-gray-300'
                        }`}>
                           <Check size={32} strokeWidth={3} />
                        </div>
                     </div>
                  );
               })}
            </div>

            {/* Footer Actions */}
            <div className="p-6 bg-white border-t border-gray-200 shadow-[0_-10px_30px_rgba(0,0,0,0.05)] mt-auto">
               <button 
                  onClick={confirmReception}
                  disabled={!someReceived}
                  className="w-full py-5 bg-green-600 active:bg-green-700 text-white rounded-2xl font-bold text-xl shadow-lg flex items-center justify-center gap-3 transition-transform active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
               >
                  <Package size={24} />
                  {allReceived ? 'Confirmar Todo' : 'Recepción Parcial'}
               </button>
            </div>
         </div>
      );
    }

    // Orders List
    return (
      <div className="animate-in fade-in h-full overflow-y-auto pb-20">
         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {activeOrders.length === 0 ? (
               <div className="col-span-full py-32 text-center text-gray-400 bg-gray-50 rounded-[3rem] border-4 border-dashed border-gray-200">
                  <ClipboardList size={64} className="mx-auto mb-4 opacity-30" />
                  <p className="text-xl font-bold">No hay órdenes pendientes</p>
                  <button onClick={() => setActiveTab('CREATE')} className="mt-4 text-blue-600 font-bold">Crear nueva orden</button>
               </div>
            ) : (
               activeOrders.map(po => {
                  const supplier = suppliers.find(s => s.id === po.supplierId);
                  const progress = po.items.reduce((acc, i) => acc + i.quantityReceived, 0) / po.items.reduce((acc, i) => acc + i.quantityOrdered, 0) * 100;
                  
                  return (
                     <div key={po.id} onClick={() => setReceivingOrderId(po.id)} className="bg-white p-6 rounded-[2rem] border border-gray-200 shadow-sm active:scale-[0.98] transition-all cursor-pointer relative overflow-hidden group">
                        <div className="absolute top-0 left-0 w-2 h-full bg-blue-500"></div>
                        
                        <div className="flex justify-between items-start mb-4 pl-4">
                           <div>
                              <h4 className="text-2xl font-bold text-gray-800">#{po.id}</h4>
                              <p className="text-gray-500 font-medium">{supplier?.name}</p>
                           </div>
                           <div className="bg-blue-50 text-blue-700 px-3 py-1 rounded-lg font-bold text-sm">
                              {new Date(po.date).toLocaleDateString()}
                           </div>
                        </div>

                        <div className="pl-4 mb-6">
                           <div className="flex justify-between items-end">
                              <div>
                                 <p className="text-xs text-gray-400 uppercase font-bold mb-1">Progreso</p>
                                 <div className="flex items-center gap-2">
                                    <span className="text-3xl font-black text-gray-800">{Math.round(progress)}%</span>
                                 </div>
                              </div>
                              <div className="text-right">
                                 <p className="text-xs text-gray-400 uppercase font-bold mb-1">Total</p>
                                 <p className="text-xl font-bold text-gray-600">{config.currencySymbol}{po.totalCost.toFixed(2)}</p>
                              </div>
                           </div>
                           <div className="w-full bg-gray-100 h-3 rounded-full mt-3 overflow-hidden">
                              <div className="bg-blue-500 h-full rounded-full transition-all duration-500" style={{ width: `${progress}%` }}></div>
                           </div>
                        </div>

                        <div className="pl-4 pt-4 border-t border-gray-100 flex justify-end">
                           <span className="text-blue-600 font-bold flex items-center gap-2 group-hover:gap-4 transition-all">
                              Recibir Mercancía <ArrowRight size={20} />
                           </span>
                        </div>
                     </div>
                  );
               })
            )}
         </div>
      </div>
    );
  };

  // --- RENDER MAIN ---
  
  if (isAuditMode) {
     return <InventoryAudit products={products} onClose={() => setIsAuditMode(false)} onCommit={handleAuditCommit} />;
  }

  return (
    <div className="h-screen w-full bg-gray-50 flex flex-col overflow-hidden">
      
      {/* Header */}
      <header className="bg-white border-b border-gray-200 p-4 shadow-sm z-30 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="p-3 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-600 transition-colors">
            <ArrowLeft size={24} />
          </button>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <Truck size={24} className="text-blue-600" />
            <span className="hidden md:inline">Abastecimiento</span>
          </h1>
        </div>
        
        {/* Navigation Tabs (Big Touch Targets) */}
        <div className="flex bg-gray-100 p-1.5 rounded-2xl overflow-x-auto no-scrollbar max-w-[70vw]">
           <button 
              onClick={() => setActiveTab('CREATE')}
              className={`px-6 py-3 rounded-xl text-sm font-bold flex items-center gap-2 transition-all whitespace-nowrap ${activeTab === 'CREATE' ? 'bg-white text-indigo-600 shadow-md' : 'text-gray-500'}`}
           >
              <ShoppingCart size={20} /> Pedido
           </button>
           <button 
              onClick={() => setActiveTab('RECEIVE')}
              className={`px-6 py-3 rounded-xl text-sm font-bold flex items-center gap-2 transition-all whitespace-nowrap ${activeTab === 'RECEIVE' ? 'bg-white text-green-600 shadow-md' : 'text-gray-500'}`}
           >
              <Archive size={20} /> Recepción
              {activeOrders.length > 0 && <span className="bg-green-500 text-white text-[10px] px-1.5 rounded-full">{activeOrders.length}</span>}
           </button>
           <button 
              onClick={() => setActiveTab('INVENTORY')}
              className={`px-6 py-3 rounded-xl text-sm font-bold flex items-center gap-2 transition-all whitespace-nowrap ${activeTab === 'INVENTORY' ? 'bg-white text-blue-600 shadow-md' : 'text-gray-500'}`}
           >
              <LayoutList size={20} /> Inventario
           </button>
           <button 
              onClick={() => setActiveTab('ALERTS')}
              className={`px-6 py-3 rounded-xl text-sm font-bold flex items-center gap-2 transition-all whitespace-nowrap ${activeTab === 'ALERTS' ? 'bg-white text-red-600 shadow-md' : 'text-gray-500'}`}
           >
              <AlertTriangle size={20} /> Alertas
              {lowStockProducts.length > 0 && <span className="bg-red-500 text-white text-[10px] px-1.5 rounded-full">{lowStockProducts.length}</span>}
           </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden p-4 lg:p-6 w-full max-w-[1600px] mx-auto">
         {activeTab === 'ALERTS' && renderAlerts()}
         {activeTab === 'CREATE' && renderCreateOrder()}
         {activeTab === 'RECEIVE' && renderReception()}
         {activeTab === 'INVENTORY' && renderInventoryList()}
      </div>

    </div>
  );
};

export default SupplyChainManager;
