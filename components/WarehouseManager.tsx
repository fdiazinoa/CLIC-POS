
import React, { useState, useMemo } from 'react';
import {
   Building2, Plus, ArrowRightLeft, MapPin,
   Check, X, Search, Package, AlertTriangle,
   Trash2, Save, ArrowRight, History, Calendar, Truck,
   Eye, Filter, ChevronRight
} from 'lucide-react';
import { Warehouse, Product, StockTransfer, StockTransferItem, BusinessConfig } from '../types';
import { validateTerminalDocument } from '../utils/validation';

interface WarehouseManagerProps {
   warehouses: Warehouse[];
   products: Product[];
   transfers: StockTransfer[]; // History
   config: BusinessConfig;
   onUpdateWarehouses: (warehouses: Warehouse[]) => void;
   onUpdateProducts: (products: Product[]) => void;
   onUpdateTransfers: (transfers: StockTransfer[]) => void;
   onClose: () => void;
}

type Tab = 'LOCATIONS' | 'TRANSFERS' | 'HISTORY';
type HistoryFilter = 'ALL' | 'IN_TRANSIT' | 'COMPLETED';

const WarehouseManager: React.FC<WarehouseManagerProps> = ({
   warehouses,
   products,
   transfers,
   config,
   onUpdateWarehouses,
   onUpdateProducts,
   onUpdateTransfers,
   onClose
}) => {
   const [activeTab, setActiveTab] = useState<Tab>('LOCATIONS');

   // Warehouse Editing
   const [editingWarehouse, setEditingWarehouse] = useState<Warehouse | null>(null);

   // Transfer State
   const [isTransferMode, setIsTransferMode] = useState(false);
   const [newTransfer, setNewTransfer] = useState<Partial<StockTransfer>>({
      items: []
   });
   const [itemSearch, setItemSearch] = useState('');

   // History State
   const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('ALL');
   const [viewingTransfer, setViewingTransfer] = useState<StockTransfer | null>(null);

   // --- WAREHOUSE CRUD ---

   const handleSaveWarehouse = () => {
      if (!editingWarehouse) return;
      const exists = warehouses.some(w => w.id === editingWarehouse.id);
      if (exists) {
         onUpdateWarehouses(warehouses.map(w => w.id === editingWarehouse.id ? editingWarehouse : w));
      } else {
         onUpdateWarehouses([...warehouses, editingWarehouse]);
      }
      setEditingWarehouse(null);
   };

   const handleCreateWarehouse = () => {
      setEditingWarehouse({
         id: `wh_${Date.now()}`,
         code: '',
         name: '',
         type: 'PHYSICAL',
         address: '',
         allowPosSale: true,
         allowNegativeStock: false,
         isMain: false,
         storeId: 'S1'
      });
   };

   // --- TRANSFER LOGIC ---

   const addItemToTransfer = (product: Product) => {
      const sourceId = newTransfer.sourceWarehouseId;
      const destId = newTransfer.destinationWarehouseId;

      if (!sourceId || !destId) {
         alert("Selecciona origen y destino primero.");
         return;
      }

      if (sourceId === destId) {
         alert("Origen y destino deben ser diferentes.");
         return;
      }

      // Validation: Check if product is active in Source Warehouse
      if (!product.activeInWarehouses?.includes(sourceId)) {
         const whName = warehouses.find(w => w.id === sourceId)?.name || 'Origen';
         alert(`Operación denegada:\n\nEl artículo "${product.name}" no está habilitado para operar en el almacén de origen (${whName}).\n\nPor favor, active el almacén en la ficha del producto.`);
         return;
      }

      // Validation: Check if product is active in Destination Warehouse
      if (!product.activeInWarehouses?.includes(destId)) {
         const whName = warehouses.find(w => w.id === destId)?.name || 'Destino';
         alert(`Operación denegada:\n\nEl artículo "${product.name}" no está habilitado en el almacén de destino (${whName}).\n\nNo se puede traspasar inventario a una ubicación donde el producto está desactivado.`);
         return;
      }

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

   const removeItemFromTransfer = (productId: string) => {
      setNewTransfer(prev => ({
         ...prev,
         items: prev.items?.filter(i => i.productId !== productId)
      }));
   };

   const updateItemQuantity = (productId: string, qty: number) => {
      setNewTransfer(prev => ({
         ...prev,
         items: prev.items?.map(i => i.productId === productId ? { ...i, quantity: Math.max(1, qty) } : i)
      }));
   };

   // STEP 1: SEND (Deduct from Source)
   const handleConfirmTransfer = () => {
      const sourceId = newTransfer.sourceWarehouseId;
      const destId = newTransfer.destinationWarehouseId;
      const items = newTransfer.items;

      if (!sourceId || !destId || !items || items.length === 0) return;

      // Validation: Check if terminal has TRANSFER document series assigned
      // Use the first terminal as default if no specific terminal context is available
      const terminalId = config.terminals?.[0]?.id || 'T1';
      const validation = validateTerminalDocument(config, terminalId, 'TRANSFER');

      if (!validation.isValid) {
         alert(validation.error);
         return;
      }

      // 1. Create Transfer Record (IN_TRANSIT)
      const transferRecord: StockTransfer = {
         id: `TR-${Date.now()}`,
         sourceWarehouseId: sourceId,
         destinationWarehouseId: destId,
         items: items,
         status: 'IN_TRANSIT',
         createdAt: new Date().toISOString(),
         sentAt: new Date().toISOString(),
         createdBy: 'Usuario Actual' // In real app, use user ID
      };

      // 2. Update Product Stocks (Only Deduct Source)
      const updatedProducts = products.map(p => {
         const transferItem = items.find(i => i.productId === p.id);
         if (transferItem) {
            const currentSource = p.stockBalances?.[sourceId] || 0;
            return {
               ...p,
               stockBalances: {
                  ...p.stockBalances,
                  [sourceId]: Math.max(0, currentSource - transferItem.quantity),
                  // Destination is NOT updated yet. It's "In Transit".
               }
            };
         }
         return p;
      });

      onUpdateProducts(updatedProducts);
      onUpdateTransfers([transferRecord, ...transfers]);

      // Reset & Go to History
      setIsTransferMode(false);
      setNewTransfer({ items: [] });
      setActiveTab('HISTORY');
      setHistoryFilter('IN_TRANSIT'); // Auto switch filter
      alert(`Traspaso #${transferRecord.id} enviado. Stock descontado del origen. Confirme recepción en Historial.`);
   };

   // STEP 2: RECEIVE (Add to Destination)
   const handleReceiveTransfer = (transferId: string) => {
      const transfer = transfers.find(t => t.id === transferId);
      if (!transfer || transfer.status !== 'IN_TRANSIT') return;

      // 1. Update Product Stocks (Add to Destination)
      const updatedProducts = products.map(p => {
         const transferItem = transfer.items.find(i => i.productId === p.id);
         if (transferItem) {
            const currentDest = p.stockBalances?.[transfer.destinationWarehouseId] || 0;
            return {
               ...p,
               stockBalances: {
                  ...p.stockBalances,
                  [transfer.destinationWarehouseId]: currentDest + transferItem.quantity
               }
            };
         }
         return p;
      });

      // 2. Update Transfer Status
      const updatedTransfers = transfers.map(t =>
         t.id === transferId
            ? { ...t, status: 'COMPLETED' as const, receivedAt: new Date().toISOString() }
            : t
      );

      onUpdateProducts(updatedProducts);
      onUpdateTransfers(updatedTransfers);
      setViewingTransfer(null); // Close modal if open
      alert(`Traspaso #${transferId} recibido. Stock añadido al destino.`);
   };

   const filteredProducts = useMemo(() => {
      if (!itemSearch) return [];
      return products.filter(p =>
         p.name.toLowerCase().includes(itemSearch.toLowerCase()) ||
         p.barcode?.includes(itemSearch)
      );
   }, [products, itemSearch]);

   const filteredTransfers = useMemo(() => {
      if (historyFilter === 'ALL') return transfers;
      return transfers.filter(t => t.status === historyFilter);
   }, [transfers, historyFilter]);

   const pendingCount = transfers.filter(t => t.status === 'IN_TRANSIT').length;

   return (
      <div className="flex flex-col h-full bg-gray-50 animate-in fade-in slide-in-from-right-10 duration-300">

         {/* Header */}
         <div className="bg-white px-8 py-6 border-b border-gray-200 flex justify-between items-center shrink-0">
            <div>
               <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
                  <Building2 className="text-purple-600" /> Gestión de Almacenes
               </h1>
               <p className="text-sm text-gray-500">Configuración de ubicaciones y transferencias de stock.</p>
            </div>
            <div className="flex gap-3">
               <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors">
                  <X size={24} />
               </button>
            </div>
         </div>

         {/* Tabs */}
         <div className="bg-white px-8 border-b border-gray-200 flex gap-8">
            <button
               onClick={() => setActiveTab('LOCATIONS')}
               className={`py-4 text-sm font-bold border-b-4 transition-all ${activeTab === 'LOCATIONS' ? 'border-purple-600 text-purple-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
            >
               Ubicaciones
            </button>
            <button
               onClick={() => setActiveTab('TRANSFERS')}
               className={`py-4 text-sm font-bold border-b-4 transition-all ${activeTab === 'TRANSFERS' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
            >
               Nuevo Traspaso
            </button>
            <button
               onClick={() => setActiveTab('HISTORY')}
               className={`py-4 text-sm font-bold border-b-4 transition-all flex items-center gap-2 ${activeTab === 'HISTORY' ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
            >
               Historial y Recepción
               {pendingCount > 0 && (
                  <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">{pendingCount}</span>
               )}
            </button>
         </div>

         <div className="flex-1 overflow-hidden p-8">

            {/* --- LOCATIONS TAB --- */}
            {activeTab === 'LOCATIONS' && (
               <div className="h-full flex flex-col">
                  <div className="flex justify-end mb-6">
                     <button onClick={handleCreateWarehouse} className="px-4 py-2 bg-purple-600 text-white rounded-xl font-bold shadow-md hover:bg-purple-700 transition-all flex items-center gap-2">
                        <Plus size={18} /> Nueva Ubicación
                     </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 overflow-y-auto pb-20">
                     {warehouses.map(wh => (
                        <div key={wh.id} className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-all group relative">
                           <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => setEditingWarehouse(wh)} className="p-2 bg-gray-100 hover:bg-purple-50 text-gray-500 hover:text-purple-600 rounded-lg">
                                 <Search size={16} /> {/* Edit icon placeholder */}
                              </button>
                           </div>

                           <div className="flex items-center gap-4 mb-4">
                              <div className={`p-3 rounded-xl ${wh.isMain ? 'bg-purple-100 text-purple-600' : 'bg-gray-100 text-gray-500'}`}>
                                 <Building2 size={24} />
                              </div>
                              <div>
                                 <h3 className="font-bold text-gray-800 text-lg">{wh.name}</h3>
                                 <p className="text-xs text-gray-400 font-mono">{wh.code}</p>
                              </div>
                           </div>

                           <div className="space-y-2 text-sm text-gray-600">
                              <p className="flex items-center gap-2"><MapPin size={14} /> {wh.address || 'Sin dirección'}</p>
                              <div className="flex gap-2 mt-3">
                                 {wh.allowPosSale ? (
                                    <span className="bg-green-100 text-green-700 px-2 py-1 rounded text-xs font-bold">Venta Activa</span>
                                 ) : (
                                    <span className="bg-red-100 text-red-700 px-2 py-1 rounded text-xs font-bold">No Venta</span>
                                 )}
                                 {wh.type === 'VIRTUAL' && (
                                    <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs font-bold">Virtual</span>
                                 )}
                              </div>
                           </div>
                        </div>
                     ))}
                  </div>
               </div>
            )}

            {/* --- TRANSFERS TAB --- */}
            {activeTab === 'TRANSFERS' && (
               <div className="h-full flex flex-col">
                  {!isTransferMode ? (
                     <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                        <ArrowRightLeft size={64} className="mb-4 opacity-50" />
                        <p className="text-lg font-bold mb-2">Nuevo Movimiento de Inventario</p>
                        <p className="text-sm mb-6 max-w-md text-center">
                           Crea una solicitud de traspaso. El stock se descontará del origen inmediatamente y quedará en "Tránsito" hasta ser recibido.
                        </p>
                        <button
                           onClick={() => setIsTransferMode(true)}
                           className="px-6 py-3 bg-blue-600 text-white rounded-xl font-bold shadow-lg hover:bg-blue-700 transition-all"
                        >
                           Iniciar Traspaso
                        </button>
                     </div>
                  ) : (
                     <div className="flex flex-col h-full gap-6">
                        {/* Transfer Header */}
                        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col md:flex-row gap-6 items-center">
                           <div className="flex-1 w-full">
                              <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Origen (Sale de aquí)</label>
                              <select
                                 value={newTransfer.sourceWarehouseId || ''}
                                 onChange={(e) => setNewTransfer({ ...newTransfer, sourceWarehouseId: e.target.value })}
                                 className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-700 outline-none focus:ring-2 focus:ring-blue-500"
                              >
                                 <option value="">-- Seleccionar --</option>
                                 {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                              </select>
                           </div>
                           <div className="text-gray-300">
                              <ArrowRight size={24} />
                           </div>
                           <div className="flex-1 w-full">
                              <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Destino (Entra aquí)</label>
                              <select
                                 value={newTransfer.destinationWarehouseId || ''}
                                 onChange={(e) => setNewTransfer({ ...newTransfer, destinationWarehouseId: e.target.value })}
                                 className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-700 outline-none focus:ring-2 focus:ring-blue-500"
                              >
                                 <option value="">-- Seleccionar --</option>
                                 {warehouses.filter(w => w.id !== newTransfer.sourceWarehouseId).map(w => (
                                    <option key={w.id} value={w.id}>{w.name}</option>
                                 ))}
                              </select>
                           </div>
                        </div>

                        {/* Item Selection */}
                        <div className="flex-1 flex gap-6 overflow-hidden">
                           <div className="flex-1 bg-white rounded-2xl border border-gray-200 shadow-sm flex flex-col">
                              <div className="p-4 border-b border-gray-100">
                                 <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                                    <input
                                       type="text"
                                       placeholder="Buscar productos..."
                                       value={itemSearch}
                                       onChange={(e) => setItemSearch(e.target.value)}
                                       className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                 </div>
                              </div>
                              <div className="flex-1 overflow-y-auto p-2">
                                 {filteredProducts.map(p => (
                                    <div
                                       key={p.id}
                                       onClick={() => addItemToTransfer(p)}
                                       className="p-3 hover:bg-gray-50 rounded-xl cursor-pointer flex justify-between items-center group transition-colors"
                                    >
                                       <div>
                                          <p className="font-bold text-gray-800 text-sm">{p.name}</p>
                                          <p className="text-xs text-gray-400 font-mono">{p.barcode}</p>
                                       </div>
                                       <button className="p-2 bg-gray-100 text-blue-600 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                                          <Plus size={16} />
                                       </button>
                                    </div>
                                 ))}
                              </div>
                           </div>

                           {/* Transfer Cart */}
                           <div className="w-1/3 bg-white rounded-2xl border border-gray-200 shadow-sm flex flex-col">
                              <div className="p-4 border-b border-gray-100 bg-blue-50/50">
                                 <h3 className="font-bold text-gray-800 flex items-center gap-2">
                                    <Package size={18} className="text-blue-600" /> Items a Transferir
                                 </h3>
                              </div>
                              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                                 {newTransfer.items?.map(item => (
                                    <div key={item.productId} className="flex justify-between items-center p-3 bg-gray-50 rounded-xl border border-gray-100">
                                       <div className="flex-1 min-w-0 pr-2">
                                          <p className="font-bold text-sm text-gray-800 truncate">{item.productName}</p>
                                          <div className="flex items-center gap-2 mt-1">
                                             <input
                                                type="number"
                                                value={item.quantity}
                                                onChange={(e) => updateItemQuantity(item.productId, parseInt(e.target.value))}
                                                className="w-16 p-1 text-center bg-white border border-gray-200 rounded text-sm font-bold outline-none"
                                             />
                                             <span className="text-xs text-gray-500">unidades</span>
                                          </div>
                                       </div>
                                       <button onClick={() => removeItemFromTransfer(item.productId)} className="text-gray-400 hover:text-red-500">
                                          <Trash2 size={18} />
                                       </button>
                                    </div>
                                 ))}
                                 {(!newTransfer.items || newTransfer.items.length === 0) && (
                                    <div className="text-center text-gray-400 py-10 text-sm">
                                       Agrega productos desde la lista izquierda.
                                    </div>
                                 )}
                              </div>
                              <div className="p-4 border-t border-gray-100 flex gap-2">
                                 <button
                                    onClick={() => setIsTransferMode(false)}
                                    className="flex-1 py-3 text-gray-500 font-bold hover:bg-gray-100 rounded-xl"
                                 >
                                    Cancelar
                                 </button>
                                 <button
                                    onClick={handleConfirmTransfer}
                                    className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl shadow-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                    disabled={!newTransfer.items?.length || !newTransfer.sourceWarehouseId || !newTransfer.destinationWarehouseId}
                                 >
                                    Confirmar Envío
                                 </button>
                              </div>
                           </div>
                        </div>
                     </div>
                  )}
               </div>
            )}

            {/* --- HISTORY TAB --- */}
            {activeTab === 'HISTORY' && (
               <div className="h-full flex flex-col">
                  <div className="mb-6 flex justify-between items-center">
                     <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <History size={20} className="text-orange-500" /> Historial de Movimientos
                     </h2>
                     <div className="flex gap-2">
                        {[
                           { id: 'ALL', label: 'Todos' },
                           { id: 'IN_TRANSIT', label: 'En Tránsito' },
                           { id: 'COMPLETED', label: 'Completados' }
                        ].map(f => (
                           <button
                              key={f.id}
                              onClick={() => setHistoryFilter(f.id as HistoryFilter)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${historyFilter === f.id ? 'bg-orange-100 text-orange-700' : 'bg-white text-gray-500 hover:bg-gray-100'
                                 }`}
                           >
                              {f.label}
                           </button>
                        ))}
                     </div>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-4 pb-20">
                     {filteredTransfers.length === 0 && (
                        <div className="text-center py-20 text-gray-400">
                           <Truck size={48} className="mx-auto mb-2 opacity-50" />
                           <p>No hay traspasos registrados con este filtro.</p>
                        </div>
                     )}
                     {filteredTransfers.map(t => {
                        const sourceName = warehouses.find(w => w.id === t.sourceWarehouseId)?.name || '???';
                        const destName = warehouses.find(w => w.id === t.destinationWarehouseId)?.name || '???';
                        const isPending = t.status === 'IN_TRANSIT';

                        return (
                           <div key={t.id} className={`bg-white p-5 rounded-2xl border-2 transition-all ${isPending ? 'border-orange-300 shadow-md' : 'border-gray-100'}`}>
                              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                                 <div>
                                    <div className="flex items-center gap-2 mb-1">
                                       <span className="font-bold text-gray-800 text-lg">#{t.id}</span>
                                       <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${isPending ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
                                          {isPending ? 'En Tránsito (Pendiente)' : 'Completado'}
                                       </span>
                                    </div>
                                    <div className="flex items-center gap-3 text-sm text-gray-500">
                                       <div className="flex items-center gap-1">
                                          <Calendar size={14} /> {new Date(t.createdAt).toLocaleDateString()}
                                       </div>
                                       <div className="flex items-center gap-1 font-medium">
                                          {sourceName} <ArrowRight size={12} /> {destName}
                                       </div>
                                    </div>
                                 </div>

                                 <div className="flex items-center gap-4 w-full md:w-auto">
                                    <div className="flex -space-x-2 overflow-hidden">
                                       {t.items.slice(0, 3).map(i => (
                                          <div key={i.productId} className="w-8 h-8 rounded-full bg-gray-100 border-2 border-white flex items-center justify-center text-[10px] font-bold text-gray-600" title={i.productName}>
                                             {i.quantity}
                                          </div>
                                       ))}
                                       {t.items.length > 3 && (
                                          <div className="w-8 h-8 rounded-full bg-gray-200 border-2 border-white flex items-center justify-center text-[10px] font-bold text-gray-600">
                                             +{t.items.length - 3}
                                          </div>
                                       )}
                                    </div>

                                    <div className="flex gap-2">
                                       <button
                                          onClick={() => setViewingTransfer(t)}
                                          className="p-2 bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200 transition-colors"
                                          title="Ver Detalles"
                                       >
                                          <Eye size={20} />
                                       </button>

                                       {isPending && (
                                          <button
                                             onClick={() => handleReceiveTransfer(t.id)}
                                             className="px-4 py-2 bg-green-600 text-white rounded-xl font-bold shadow-md hover:bg-green-700 active:scale-95 transition-all flex items-center gap-2 text-sm"
                                          >
                                             <Check size={16} /> Recibir
                                          </button>
                                       )}
                                    </div>
                                 </div>
                              </div>
                           </div>
                        );
                     })}
                  </div>
               </div>
            )}

         </div>

         {/* Warehouse Editor Modal */}
         {editingWarehouse && (
            <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
               <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
                  <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                     <h3 className="font-black text-xl text-gray-800">{editingWarehouse.id.includes('wh_') && editingWarehouse.name === '' ? 'Nueva Ubicación' : 'Editar Ubicación'}</h3>
                     <button onClick={() => setEditingWarehouse(null)} className="p-2 hover:bg-gray-200 rounded-full"><X size={20} /></button>
                  </div>
                  <div className="p-6 space-y-4">
                     <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nombre Almacén</label>
                        <input
                           type="text"
                           value={editingWarehouse.name}
                           onChange={(e) => setEditingWarehouse({ ...editingWarehouse, name: e.target.value })}
                           className="w-full p-3 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-purple-500"
                        />
                     </div>
                     <div className="grid grid-cols-2 gap-4">
                        <div>
                           <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Código</label>
                           <input
                              type="text"
                              value={editingWarehouse.code}
                              onChange={(e) => setEditingWarehouse({ ...editingWarehouse, code: e.target.value.toUpperCase() })}
                              className="w-full p-3 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-purple-500 uppercase"
                           />
                        </div>
                        <div>
                           <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Tipo</label>
                           <select
                              value={editingWarehouse.type}
                              onChange={(e) => setEditingWarehouse({ ...editingWarehouse, type: e.target.value as any })}
                              className="w-full p-3 bg-white border border-gray-200 rounded-xl outline-none"
                           >
                              <option value="PHYSICAL">Físico</option>
                              <option value="VIRTUAL">Virtual (Mermas)</option>
                              <option value="DISTRIBUTION">Centro Dist.</option>
                           </select>
                        </div>
                     </div>
                     <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Dirección</label>
                        <input
                           type="text"
                           value={editingWarehouse.address}
                           onChange={(e) => setEditingWarehouse({ ...editingWarehouse, address: e.target.value })}
                           className="w-full p-3 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-purple-500"
                        />
                     </div>
                     <div className="flex gap-4 pt-2">
                        <label className="flex items-center gap-2 cursor-pointer bg-gray-50 px-4 py-2 rounded-lg border border-gray-200 flex-1">
                           <input
                              type="checkbox"
                              checked={editingWarehouse.allowPosSale}
                              onChange={(e) => setEditingWarehouse({ ...editingWarehouse, allowPosSale: e.target.checked })}
                              className="w-4 h-4 text-purple-600 rounded"
                           />
                           <span className="text-sm font-bold text-gray-700">Permitir Venta POS</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer bg-gray-50 px-4 py-2 rounded-lg border border-gray-200 flex-1">
                           <input
                              type="checkbox"
                              checked={editingWarehouse.allowNegativeStock}
                              onChange={(e) => setEditingWarehouse({ ...editingWarehouse, allowNegativeStock: e.target.checked })}
                              className="w-4 h-4 text-purple-600 rounded"
                           />
                           <span className="text-sm font-bold text-gray-700">Stock Negativo</span>
                        </label>
                     </div>
                  </div>
                  <div className="p-6 border-t border-gray-100 bg-gray-50 flex gap-3">
                     <button onClick={() => setEditingWarehouse(null)} className="flex-1 py-3 text-gray-500 font-bold hover:bg-gray-200 rounded-xl">Cancelar</button>
                     <button onClick={handleSaveWarehouse} className="flex-1 py-3 bg-purple-600 text-white font-bold rounded-xl shadow-md hover:bg-purple-700">Guardar</button>
                  </div>
               </div>
            </div>
         )}

         {/* Transfer Detail Modal */}
         {viewingTransfer && (
            <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
               <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
                  <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                     <div>
                        <h3 className="font-bold text-lg text-gray-800">Detalles de Traspaso</h3>
                        <p className="text-xs text-gray-500 font-mono">#{viewingTransfer.id}</p>
                     </div>
                     <button onClick={() => setViewingTransfer(null)} className="p-2 hover:bg-gray-200 rounded-full"><X size={20} /></button>
                  </div>

                  <div className="p-5 border-b border-gray-100">
                     <div className="flex items-center justify-between text-sm mb-2">
                        <span className="text-gray-500">Estado</span>
                        <span className={`font-bold px-2 py-0.5 rounded text-xs uppercase ${viewingTransfer.status === 'IN_TRANSIT' ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
                           {viewingTransfer.status === 'IN_TRANSIT' ? 'En Tránsito' : 'Completado'}
                        </span>
                     </div>
                     <div className="flex justify-between items-center bg-blue-50 p-3 rounded-xl border border-blue-100">
                        <div className="text-center flex-1">
                           <span className="block text-[10px] font-bold text-blue-400 uppercase">Origen</span>
                           <span className="font-bold text-blue-900 text-sm">{warehouses.find(w => w.id === viewingTransfer.sourceWarehouseId)?.name}</span>
                        </div>
                        <ArrowRight size={16} className="text-blue-300" />
                        <div className="text-center flex-1">
                           <span className="block text-[10px] font-bold text-blue-400 uppercase">Destino</span>
                           <span className="font-bold text-blue-900 text-sm">{warehouses.find(w => w.id === viewingTransfer.destinationWarehouseId)?.name}</span>
                        </div>
                     </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-5 space-y-2">
                     <h4 className="text-xs font-bold text-gray-400 uppercase mb-2">Items Incluidos</h4>
                     {viewingTransfer.items.map((item, idx) => (
                        <div key={idx} className="flex justify-between items-center p-3 border border-gray-100 rounded-xl hover:bg-gray-50">
                           <span className="font-medium text-gray-700 text-sm">{item.productName}</span>
                           <span className="font-bold text-gray-900 bg-gray-100 px-2 py-1 rounded-lg text-sm">{item.quantity}</span>
                        </div>
                     ))}
                  </div>

                  {viewingTransfer.status === 'IN_TRANSIT' && (
                     <div className="p-5 border-t border-gray-100 bg-gray-50">
                        <button
                           onClick={() => handleReceiveTransfer(viewingTransfer.id)}
                           className="w-full py-3 bg-green-600 text-white rounded-xl font-bold shadow-lg hover:bg-green-700 active:scale-95 transition-all flex items-center justify-center gap-2"
                        >
                           <Check size={20} /> Confirmar Recepción
                        </button>
                     </div>
                  )}
               </div>
            </div>
         )}

      </div>
   );
};

export default WarehouseManager;
