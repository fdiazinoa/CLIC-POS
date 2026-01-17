
import React, { useState, useMemo } from 'react';
import { 
  ArrowLeft, Plus, MapPin, Building2, Trash2, Save, Wifi, AlertTriangle, 
  ArrowRightLeft, Truck, Package, Search, ChevronRight, Check, X,
  Clock, CheckCircle2, User, RefreshCw, ArrowRight, Minus, Eye, Edit
} from 'lucide-react';
import { Warehouse, WarehouseType, Product, StockTransfer, StockTransferItem } from '../types';

interface WarehouseManagerProps {
  warehouses: Warehouse[];
  products: Product[]; // Need products to select items for transfer
  onUpdateWarehouses: (warehouses: Warehouse[]) => void;
  onClose: () => void;
}

const WarehouseManager: React.FC<WarehouseManagerProps> = ({ warehouses, products, onUpdateWarehouses, onClose }) => {
  const [activeTab, setActiveTab] = useState<'LOCATIONS' | 'TRANSFERS'>('LOCATIONS');
  
  // Locations State
  const [editingWh, setEditingWh] = useState<Warehouse | null>(null);

  // Transfers State
  const [transfers, setTransfers] = useState<StockTransfer[]>([]); // In real app, this comes from props or API
  const [showTransferWizard, setShowTransferWizard] = useState(false);
  const [viewingTransfer, setViewingTransfer] = useState<StockTransfer | null>(null);
  
  // Wizard State
  const [transferStep, setTransferStep] = useState<1 | 2 | 3>(1);
  const [newTransfer, setNewTransfer] = useState<Partial<StockTransfer>>({ items: [] });
  const [itemSearch, setItemSearch] = useState('');

  // --- WAREHOUSE HANDLERS ---
  const handleSaveWarehouse = (wh: Warehouse) => {
    const updatedList = (() => {
      const exists = warehouses.find(i => i.id === wh.id);
      if (exists) return warehouses.map(i => i.id === wh.id ? wh : i);
      return [...warehouses, wh];
    })();
    onUpdateWarehouses(updatedList);
    setEditingWh(null);
  };

  const deleteWarehouse = (id: string) => {
    if (confirm("¿Estás seguro? Se validará que no existan productos con stock físico.")) {
      onUpdateWarehouses(warehouses.filter(w => w.id !== id));
    }
  };

  // --- TRANSFER HANDLERS ---
  
  const handleSaveTransfer = () => {
    if (!newTransfer.sourceWarehouseId || !newTransfer.destinationWarehouseId || !newTransfer.items?.length) return;
    
    if (newTransfer.id) {
      // Update Existing
      setTransfers(prev => prev.map(t => t.id === newTransfer.id ? { ...t, ...newTransfer } as StockTransfer : t));
    } else {
      // Create New
      const finalTransfer: StockTransfer = {
        id: `TR-${Date.now().toString().slice(-6)}`,
        sourceWarehouseId: newTransfer.sourceWarehouseId,
        destinationWarehouseId: newTransfer.destinationWarehouseId,
        items: newTransfer.items,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        createdBy: 'Admin User', // Mock
      };
      setTransfers([finalTransfer, ...transfers]);
    }

    setShowTransferWizard(false);
    setNewTransfer({ items: [] });
    setTransferStep(1);
  };

  const handleEditTransfer = (e: React.MouseEvent, transfer: StockTransfer) => {
    e.stopPropagation();
    setNewTransfer({
      id: transfer.id,
      sourceWarehouseId: transfer.sourceWarehouseId,
      destinationWarehouseId: transfer.destinationWarehouseId,
      items: [...transfer.items]
    });
    setTransferStep(2); // Jump directly to items
    setShowTransferWizard(true);
  };

  const handleSendTransfer = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setTransfers(prev => prev.map(t => t.id === id ? { ...t, status: 'IN_TRANSIT', sentAt: new Date().toISOString() } : t));
    // Here logic to deduct stock from Source would go
  };

  const handleReceiveTransfer = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setTransfers(prev => prev.map(t => t.id === id ? { ...t, status: 'COMPLETED', receivedAt: new Date().toISOString() } : t));
    // Here logic to add stock to Destination would go
  };

  const addItemToTransfer = (product: Product) => {
    setNewTransfer(prev => {
      const items = prev.items || [];
      const existing = items.find(i => i.productId === product.id);
      
      let newItems;
      if (existing) {
        newItems = items.map(i => i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i);
      } else {
        newItems = [...items, { 
          productId: product.id, 
          productName: product.name, 
          quantity: 1 
        }];
      }
      
      return { ...prev, items: newItems };
    });
    setItemSearch('');
  };

  const updateItemQuantity = (productId: string, delta: number) => {
    setNewTransfer(prev => {
        const items = prev.items || [];
        return {
            ...prev,
            items: items.map(i => {
                if (i.productId === productId) {
                    return { ...i, quantity: Math.max(1, i.quantity + delta) };
                }
                return i;
            })
        };
    });
  };

  const removeItem = (productId: string) => {
     setNewTransfer(prev => ({
         ...prev,
         items: (prev.items || []).filter(i => i.productId !== productId)
     }));
  };

  // --- FILTERED LISTS ---
  const filteredProducts = useMemo(() => {
    if (!itemSearch) return [];
    return products.filter(p => p.name.toLowerCase().includes(itemSearch.toLowerCase()) || p.barcode?.includes(itemSearch));
  }, [products, itemSearch]);

  const sourceWh = warehouses.find(w => w.id === newTransfer.sourceWarehouseId);
  const destWh = warehouses.find(w => w.id === newTransfer.destinationWarehouseId);

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 flex flex-col overflow-hidden animate-in fade-in">
      <header className="bg-white border-b p-4 flex items-center justify-between shadow-sm shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full"><ArrowLeft /></button>
          <div>
             <h1 className="text-xl font-bold text-gray-800">Logística y Almacenes</h1>
             <p className="text-xs text-gray-400">Gestión de ubicaciones y movimientos</p>
          </div>
        </div>
        
        {/* TABS */}
        <div className="flex bg-gray-100 p-1 rounded-xl">
           <button 
              onClick={() => setActiveTab('LOCATIONS')}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'LOCATIONS' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
           >
              Ubicaciones
           </button>
           <button 
              onClick={() => setActiveTab('TRANSFERS')}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'TRANSFERS' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
           >
              Traspasos
           </button>
        </div>

        <div>
           {activeTab === 'LOCATIONS' ? (
              <button 
                onClick={() => setEditingWh({ id: Date.now().toString(), code: '', name: '', type: 'PHYSICAL', address: '', allowPosSale: true, allowNegativeStock: false, isMain: false, storeId: 'S1' })}
                className="bg-blue-600 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 hover:bg-blue-700 transition-colors"
              >
                <Plus size={20} /> Nuevo Almacén
              </button>
           ) : (
              <button 
                onClick={() => {
                  setNewTransfer({ items: [] });
                  setTransferStep(1);
                  setShowTransferWizard(true);
                }}
                className="bg-blue-600 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 hover:bg-blue-700 transition-colors"
              >
                <ArrowRightLeft size={20} /> Nuevo Traspaso
              </button>
           )}
        </div>
      </header>

      <div className="flex-1 p-6 overflow-y-auto max-w-6xl mx-auto w-full">
        
        {/* === LOCATIONS TAB === */}
        {activeTab === 'LOCATIONS' && (
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-in fade-in slide-in-from-right-4">
             {warehouses.map(wh => (
               <div key={wh.id} className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between group hover:border-blue-300 transition-all">
                 <div className="flex gap-4 mb-4">
                   <div className={`p-3 rounded-xl h-fit ${wh.type === 'DISTRIBUTION' ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>
                     <Building2 size={24} />
                   </div>
                   <div>
                     <h3 className="font-bold text-gray-900 text-lg">{wh.name}</h3>
                     <p className="text-xs font-mono text-gray-400 bg-gray-100 px-2 py-0.5 rounded inline-block mt-1">{wh.code}</p>
                     <p className="text-sm text-gray-500 flex items-center gap-1 mt-2"><MapPin size={12}/> {wh.address || 'Sin dirección'}</p>
                   </div>
                 </div>
                 
                 <div className="flex justify-between items-center border-t border-gray-100 pt-4">
                    <div className="flex gap-2">
                       {wh.allowPosSale && <span className="text-[10px] font-bold bg-green-100 text-green-700 px-2 py-1 rounded uppercase tracking-wider">Venta POS</span>}
                       {wh.isMain && <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-1 rounded uppercase tracking-wider">Principal</span>}
                    </div>
                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                       <button onClick={() => setEditingWh(wh)} className="p-2 text-gray-400 hover:text-blue-600 bg-gray-50 rounded-lg"><Wifi size={16}/></button>
                       <button onClick={() => deleteWarehouse(wh.id)} className="p-2 text-gray-400 hover:text-red-600 bg-gray-50 rounded-lg"><Trash2 size={16}/></button>
                    </div>
                 </div>
               </div>
             ))}
           </div>
        )}

        {/* === TRANSFERS TAB (Hub de Movimientos) === */}
        {activeTab === 'TRANSFERS' && (
           <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
              
              {/* Stats / Filters */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                 <div className="bg-white p-4 rounded-2xl border border-gray-200 flex items-center gap-4">
                    <div className="p-3 bg-orange-100 text-orange-600 rounded-xl"><Clock size={24}/></div>
                    <div>
                       <p className="text-xs text-gray-400 uppercase font-bold">Pendientes de Envío</p>
                       <p className="text-2xl font-black text-gray-800">{transfers.filter(t => t.status === 'PENDING').length}</p>
                    </div>
                 </div>
                 <div className="bg-white p-4 rounded-2xl border border-gray-200 flex items-center gap-4">
                    <div className="p-3 bg-blue-100 text-blue-600 rounded-xl"><Truck size={24}/></div>
                    <div>
                       <p className="text-xs text-gray-400 uppercase font-bold">En Tránsito</p>
                       <p className="text-2xl font-black text-gray-800">{transfers.filter(t => t.status === 'IN_TRANSIT').length}</p>
                    </div>
                 </div>
                 <div className="bg-white p-4 rounded-2xl border border-gray-200 flex items-center gap-4">
                    <div className="p-3 bg-green-100 text-green-600 rounded-xl"><CheckCircle2 size={24}/></div>
                    <div>
                       <p className="text-xs text-gray-400 uppercase font-bold">Recibidos (Hoy)</p>
                       <p className="text-2xl font-black text-gray-800">{transfers.filter(t => t.status === 'COMPLETED').length}</p>
                    </div>
                 </div>
              </div>

              {/* Transfer List */}
              <div className="bg-white rounded-3xl shadow-sm border border-gray-200 overflow-hidden">
                 <div className="p-4 bg-gray-50 border-b border-gray-100 font-bold text-gray-500 text-sm">Movimientos Recientes</div>
                 <div className="divide-y divide-gray-100">
                    {transfers.length === 0 ? (
                       <div className="p-10 text-center text-gray-400">No hay movimientos registrados.</div>
                    ) : (
                       transfers.map(t => {
                          const src = warehouses.find(w => w.id === t.sourceWarehouseId)?.name;
                          const dst = warehouses.find(w => w.id === t.destinationWarehouseId)?.name;
                          
                          return (
                             <div 
                                key={t.id} 
                                onClick={() => setViewingTransfer(t)}
                                className="p-6 flex items-center justify-between hover:bg-gray-50 transition-colors cursor-pointer group"
                             >
                                <div className="flex items-center gap-6">
                                   <div className={`p-3 rounded-2xl ${
                                      t.status === 'PENDING' ? 'bg-orange-50 text-orange-600' :
                                      t.status === 'IN_TRANSIT' ? 'bg-blue-50 text-blue-600' :
                                      'bg-green-50 text-green-600'
                                   }`}>
                                      <ArrowRightLeft size={24} />
                                   </div>
                                   <div>
                                      <div className="flex items-center gap-2 mb-1">
                                         <span className="font-bold text-gray-800 text-lg">{t.id}</span>
                                         <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                            t.status === 'PENDING' ? 'bg-orange-100 text-orange-700' :
                                            t.status === 'IN_TRANSIT' ? 'bg-blue-100 text-blue-700' :
                                            'bg-green-100 text-green-700'
                                         }`}>{t.status.replace('_', ' ')}</span>
                                      </div>
                                      <div className="flex items-center gap-2 text-sm text-gray-500">
                                         <span>{src}</span>
                                         <ArrowRight size={14} className="text-gray-300" />
                                         <span>{dst}</span>
                                         <span className="text-gray-300 mx-1">|</span>
                                         <span className="font-medium text-gray-700">{t.items.length} Artículos</span>
                                      </div>
                                   </div>
                                </div>

                                <div className="flex items-center gap-3">
                                   {t.status === 'PENDING' && (
                                      <>
                                        <button 
                                          onClick={(e) => handleEditTransfer(e, t)}
                                          className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors border border-gray-200"
                                          title="Modificar Envío"
                                        >
                                          <Edit size={18} />
                                        </button>
                                        <button 
                                          onClick={(e) => handleSendTransfer(e, t.id)} 
                                          className="px-4 py-2 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 shadow-md"
                                        >
                                           Confirmar Envío
                                        </button>
                                      </>
                                   )}
                                   {t.status === 'IN_TRANSIT' && (
                                      <button onClick={(e) => handleReceiveTransfer(e, t.id)} className="px-4 py-2 bg-green-600 text-white rounded-xl font-bold text-sm hover:bg-green-700 shadow-md flex items-center gap-2">
                                         <Package size={16} /> Recibir Mercancía
                                      </button>
                                   )}
                                   {t.status === 'COMPLETED' && (
                                      <span className="text-xs font-bold text-gray-400">Finalizado</span>
                                   )}
                                   <div className="p-2 text-gray-300 group-hover:text-blue-500 transition-colors">
                                      <Eye size={20} />
                                   </div>
                                </div>
                             </div>
                          );
                       })
                    )}
                 </div>
              </div>
           </div>
        )}

      </div>

      {/* --- WAREHOUSE CONFIG MODAL --- */}
      {editingWh && (
        <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-lg p-6 shadow-2xl animate-in zoom-in-95">
            <h2 className="text-2xl font-black text-gray-800 mb-6">Configurar Almacén</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <input type="text" placeholder="Código Corto" value={editingWh.code} onChange={e => setEditingWh({...editingWh, code: e.target.value})} className="p-3 border rounded-xl" />
                <input type="text" placeholder="Nombre Almacén" value={editingWh.name} onChange={e => setEditingWh({...editingWh, name: e.target.value})} className="p-3 border rounded-xl" />
              </div>
              <select value={editingWh.type} onChange={e => setEditingWh({...editingWh, type: e.target.value as WarehouseType})} className="w-full p-3 border rounded-xl">
                <option value="PHYSICAL">Físico / Venta POS</option>
                <option value="DISTRIBUTION">Centro de Distribución</option>
                <option value="VIRTUAL">Virtual / Mermas</option>
                <option value="TRANSIT">En Tránsito</option>
              </select>
              <input type="text" placeholder="Dirección Física" value={editingWh.address} onChange={e => setEditingWh({...editingWh, address: e.target.value})} className="w-full p-3 border rounded-xl" />
              
              <div className="space-y-3 pt-2">
                <label className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100 cursor-pointer">
                  <span className="font-bold text-sm text-gray-700">¿Permitir Venta en POS?</span>
                  <input type="checkbox" checked={editingWh.allowPosSale} onChange={e => setEditingWh({...editingWh, allowPosSale: e.target.checked})} className="w-5 h-5 rounded" />
                </label>
                <label className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100 cursor-pointer">
                  <span className="font-bold text-sm text-gray-700">¿Permitir Stock Negativo?</span>
                  <input type="checkbox" checked={editingWh.allowNegativeStock} onChange={e => setEditingWh({...editingWh, allowNegativeStock: e.target.checked})} className="w-5 h-5 rounded" />
                </label>
              </div>
            </div>
            <div className="flex gap-3 mt-8">
              <button onClick={() => setEditingWh(null)} className="flex-1 py-4 text-gray-500 font-bold">Cancelar</button>
              <button onClick={() => handleSaveWarehouse(editingWh)} className="flex-[2] py-4 bg-blue-600 text-white rounded-2xl font-bold shadow-lg flex items-center justify-center gap-2">
                <Save size={20} /> Guardar Almacén
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- VIEW DETAIL MODAL --- */}
      {viewingTransfer && (
        <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-2xl p-6 shadow-2xl animate-in zoom-in-95 flex flex-col max-h-[80vh]">
             <div className="flex justify-between items-center mb-6 border-b border-gray-100 pb-4">
                <div>
                   <h3 className="text-xl font-black text-gray-800 flex items-center gap-2">
                      <Truck size={24} className="text-blue-600" />
                      Detalle de Traspaso
                   </h3>
                   <p className="text-sm text-gray-500 font-mono mt-1">{viewingTransfer.id}</p>
                </div>
                <button onClick={() => setViewingTransfer(null)} className="p-2 hover:bg-gray-100 rounded-full">
                   <X size={24} className="text-gray-400" />
                </button>
             </div>

             <div className="flex justify-between items-center bg-gray-50 p-4 rounded-xl mb-4 text-sm">
                <div className="text-center">
                   <p className="text-xs font-bold text-gray-400 uppercase">Origen</p>
                   <p className="font-bold text-gray-800">{warehouses.find(w => w.id === viewingTransfer.sourceWarehouseId)?.name}</p>
                </div>
                <ArrowRight className="text-gray-300" />
                <div className="text-center">
                   <p className="text-xs font-bold text-gray-400 uppercase">Destino</p>
                   <p className="font-bold text-gray-800">{warehouses.find(w => w.id === viewingTransfer.destinationWarehouseId)?.name}</p>
                </div>
             </div>

             <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                {viewingTransfer.items.map((item, idx) => (
                   <div key={idx} className="flex justify-between p-3 border-b border-gray-100 last:border-0">
                      <span className="font-medium text-gray-700">{item.productName}</span>
                      <span className="font-bold text-gray-900 bg-gray-100 px-2 py-0.5 rounded text-sm">x{item.quantity}</span>
                   </div>
                ))}
             </div>

             <div className="pt-6 mt-4 border-t border-gray-100 flex justify-end">
                <button onClick={() => setViewingTransfer(null)} className="px-6 py-3 bg-gray-900 text-white rounded-xl font-bold hover:bg-black">
                   Cerrar
                </button>
             </div>
          </div>
        </div>
      )}

      {/* --- TRANSFER WIZARD --- */}
      {showTransferWizard && (
         <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
            <div className="bg-white rounded-[2rem] w-full max-w-2xl h-[80vh] flex flex-col shadow-2xl animate-in zoom-in-95">
               
               {/* Wizard Header */}
               <div className="p-6 border-b border-gray-100 bg-gray-50 rounded-t-[2rem]">
                  <div className="flex justify-between items-center mb-6">
                     <h2 className="text-2xl font-black text-gray-800">{newTransfer.id ? 'Modificar Traspaso' : 'Nuevo Traspaso'}</h2>
                     <button onClick={() => setShowTransferWizard(false)} className="p-2 hover:bg-gray-200 rounded-full text-gray-500"><X size={20}/></button>
                  </div>
                  
                  {/* Progress Bar */}
                  <div className="flex items-center justify-between relative px-4">
                     <div className="absolute top-1/2 left-0 w-full h-1 bg-gray-200 -z-0"></div>
                     <div className={`absolute top-1/2 left-0 h-1 bg-blue-600 -z-0 transition-all duration-300`} style={{ width: transferStep === 1 ? '0%' : transferStep === 2 ? '50%' : '100%' }}></div>
                     
                     {[1,2,3].map(step => (
                        <div key={step} className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs relative z-10 transition-colors ${transferStep >= step ? 'bg-blue-600 text-white shadow-lg' : 'bg-white border-2 border-gray-200 text-gray-400'}`}>
                           {step}
                        </div>
                     ))}
                  </div>
                  <div className="flex justify-between text-xs font-bold text-gray-400 mt-2 px-2">
                     <span>Ruta</span>
                     <span>Artículos</span>
                     <span>Confirmar</span>
                  </div>
               </div>

               {/* Wizard Content */}
               <div className="flex-1 overflow-y-auto p-8">
                  
                  {/* STEP 1: ROUTE */}
                  {transferStep === 1 && (
                     <div className="space-y-8 animate-in slide-in-from-right-4">
                        <div className="grid grid-cols-2 gap-8">
                           <div className="space-y-4">
                              <label className="block text-sm font-bold text-gray-500 uppercase tracking-wide">Almacén Origen</label>
                              <div className="space-y-2">
                                 {warehouses.map(wh => (
                                    <div 
                                       key={wh.id} 
                                       onClick={() => setNewTransfer({...newTransfer, sourceWarehouseId: wh.id})}
                                       className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${newTransfer.sourceWarehouseId === wh.id ? 'bg-blue-50 border-blue-500 text-blue-700' : 'bg-white border-gray-200 hover:border-gray-300'}`}
                                    >
                                       <span className="font-bold">{wh.name}</span>
                                    </div>
                                 ))}
                              </div>
                           </div>
                           <div className="space-y-4">
                              <label className="block text-sm font-bold text-gray-500 uppercase tracking-wide">Almacén Destino</label>
                              <div className="space-y-2">
                                 {warehouses.filter(w => w.id !== newTransfer.sourceWarehouseId).map(wh => (
                                    <div 
                                       key={wh.id} 
                                       onClick={() => setNewTransfer({...newTransfer, destinationWarehouseId: wh.id})}
                                       className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${newTransfer.destinationWarehouseId === wh.id ? 'bg-green-50 border-green-500 text-green-700' : 'bg-white border-gray-200 hover:border-gray-300'}`}
                                    >
                                       <span className="font-bold">{wh.name}</span>
                                    </div>
                                 ))}
                              </div>
                           </div>
                        </div>
                     </div>
                  )}

                  {/* STEP 2: ITEMS */}
                  {transferStep === 2 && (
                     <div className="h-full flex flex-col animate-in slide-in-from-right-4">
                        <div className="relative mb-6">
                           <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                           <input 
                              type="text" 
                              placeholder="Buscar para agregar (Auto-add)..."
                              value={itemSearch}
                              onChange={e => setItemSearch(e.target.value)}
                              className="w-full pl-12 pr-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl outline-none focus:border-blue-300 font-bold"
                              autoFocus
                           />
                           {itemSearch && (
                              <div className="absolute top-full left-0 w-full bg-white shadow-xl rounded-xl mt-2 border border-gray-100 max-h-60 overflow-y-auto z-20">
                                 {filteredProducts.map(p => (
                                    <div 
                                       key={p.id} 
                                       onClick={() => addItemToTransfer(p)}
                                       className="p-3 hover:bg-blue-50 cursor-pointer flex justify-between items-center"
                                    >
                                       <span>{p.name}</span>
                                       <span className="text-xs bg-gray-100 px-2 py-1 rounded">Stock: {p.stock}</span>
                                    </div>
                                 ))}
                              </div>
                           )}
                        </div>

                        <div className="flex-1 overflow-y-auto space-y-2">
                           {newTransfer.items?.map((item, idx) => (
                              <div key={idx} className="flex justify-between items-center p-3 bg-white border border-gray-100 rounded-xl shadow-sm">
                                 <span className="font-medium text-gray-700">{item.productName}</span>
                                 <div className="flex items-center gap-2">
                                    <button 
                                      onClick={() => updateItemQuantity(item.productId, -1)}
                                      className="p-1 hover:bg-gray-100 rounded text-gray-500"
                                    >
                                      <Minus size={16} />
                                    </button>
                                    <span className="font-bold bg-gray-50 px-3 py-1 rounded-lg text-sm w-12 text-center">{item.quantity}</span>
                                    <button 
                                      onClick={() => updateItemQuantity(item.productId, 1)}
                                      className="p-1 hover:bg-gray-100 rounded text-gray-500"
                                    >
                                      <Plus size={16} />
                                    </button>
                                    <button 
                                      onClick={() => removeItem(item.productId)}
                                      className="p-2 ml-2 hover:bg-red-50 text-gray-300 hover:text-red-500 rounded-lg"
                                    >
                                      <Trash2 size={16} />
                                    </button>
                                 </div>
                              </div>
                           ))}
                           {(!newTransfer.items || newTransfer.items.length === 0) && (
                              <div className="text-center text-gray-400 py-10">Busca artículos para agregar a la lista.</div>
                           )}
                        </div>
                     </div>
                  )}

                  {/* STEP 3: CONFIRM */}
                  {transferStep === 3 && (
                     <div className="space-y-6 animate-in slide-in-from-right-4 text-center">
                        <div className="w-24 h-24 bg-blue-50 rounded-full flex items-center justify-center mx-auto text-blue-600 shadow-inner">
                           <RefreshCw size={48} />
                        </div>
                        <h3 className="text-2xl font-black text-gray-800">Resumen del Traspaso</h3>
                        
                        <div className="flex items-center justify-center gap-4 text-lg font-bold text-gray-600 bg-gray-50 p-4 rounded-xl">
                           <span>{sourceWh?.name}</span>
                           <ArrowRight className="text-blue-500" />
                           <span>{destWh?.name}</span>
                        </div>

                        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden text-left">
                           <div className="p-3 bg-gray-50 border-b border-gray-100 text-xs font-bold text-gray-500 uppercase">Items ({newTransfer.items?.length})</div>
                           <div className="p-4 max-h-48 overflow-y-auto space-y-2">
                              {newTransfer.items?.map((i, idx) => (
                                 <div key={idx} className="flex justify-between text-sm">
                                    <span>{i.productName}</span>
                                    <span className="font-bold">x{i.quantity}</span>
                                 </div>
                              ))}
                           </div>
                        </div>
                     </div>
                  )}

               </div>

               {/* Wizard Footer */}
               <div className="p-6 border-t border-gray-100 bg-white flex justify-between">
                  {transferStep > 1 ? (
                     <button onClick={() => setTransferStep((s) => s - 1 as any)} className="px-6 py-3 text-gray-500 font-bold hover:bg-gray-50 rounded-xl">
                        Atrás
                     </button>
                  ) : <div></div>}
                  
                  <button 
                     onClick={() => {
                        if (transferStep < 3) {
                           if (transferStep === 1 && (!newTransfer.sourceWarehouseId || !newTransfer.destinationWarehouseId)) return alert("Selecciona origen y destino");
                           setTransferStep((s) => s + 1 as any);
                        } else {
                           handleSaveTransfer();
                        }
                     }}
                     className="px-8 py-3 bg-blue-600 text-white rounded-xl font-bold shadow-lg hover:bg-blue-700 transition-all flex items-center gap-2"
                  >
                     {transferStep === 3 ? <CheckCircle2 size={20} /> : null}
                     {transferStep === 3 ? (newTransfer.id ? 'Guardar Cambios' : 'Confirmar Envío') : 'Siguiente'}
                  </button>
               </div>

            </div>
         </div>
      )}

    </div>
  );
};

export default WarehouseManager;
