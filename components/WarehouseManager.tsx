
import React, { useState, useMemo, useEffect } from 'react';
import {
   Building2, Plus, ArrowRightLeft, MapPin,
   Check, X, Search, Package, AlertTriangle,
   Trash2, Save, ArrowRight, History, Calendar, Truck, Minus,
   Eye, Filter, ChevronRight, Sparkles, LayoutGrid, ChevronDown, Zap, ShoppingBag, ClipboardList
} from 'lucide-react';
import { Warehouse, Product, StockTransfer, StockTransferItem, BusinessConfig, LedgerConcept, RoleDefinition, User } from '../types';
import { validateTerminalDocument, validateWarehouseAccess } from '../utils/validation';
import { db } from '../utils/db';

interface WarehouseManagerProps {
   warehouses: Warehouse[];
   products: Product[];
   transfers: StockTransfer[]; // History
   suppliers: Supplier[];
   purchaseOrders: PurchaseOrder[];
   parkedTickets: any[];
   config: BusinessConfig;
   internalSequences: any[];
   currentUser: User | null;
   roles: RoleDefinition[];
   onUpdateWarehouses: (warehouses: Warehouse[]) => void;
   onUpdateProducts: (products: Product[]) => void;
   onUpdateTransfers: (transfers: StockTransfer[]) => void;
   onUpdateSequences: (sequences: any[]) => void;
   onAdjustStock: (adjustments: { productId: string; quantity: number }[]) => void;
   onClose: () => void;
   terminalId?: string;
}

type Tab = 'LOCATIONS' | 'TRANSFERS' | 'HISTORY' | 'OPTIMIZER' | 'FORECASTING' | 'INVENTORY' | 'AUDIT_CLOSURE';
type HistoryFilter = 'ALL' | 'IN_TRANSIT' | 'COMPLETED';

import InventoryOptimizer from './InventoryOptimizer';
import SmartReplenishment from './SmartReplenishment';
import { Supplier, PurchaseOrder } from '../types';
import InventoryAudit from './InventoryAudit';
import InventoryAuditClosure from './inventory/InventoryAuditClosure';
import ErrorBoundary from './ErrorBoundary';
import { ScanBarcode } from 'lucide-react';

const WarehouseManager: React.FC<WarehouseManagerProps> = ({
   warehouses,
   products,
   transfers,
   config,
   internalSequences,
   suppliers,
   purchaseOrders,
   parkedTickets,
   onUpdateWarehouses,
   onUpdateProducts,
   onUpdateTransfers,
   onUpdateSequences,
   onAdjustStock,
   onClose,
   terminalId,
   currentUser,
   roles
}) => {
   const [activeTab, setActiveTab] = useState<Tab>('LOCATIONS');

   // Fallback Data Loading
   useEffect(() => {
      const loadTransfers = async () => {
         if (!transfers || transfers.length === 0) {
            console.log('🔄 [WarehouseManager] Transfers prop is empty. Attempting backup fetch from DB...');
            try {
               const dbTransfers = await db.get('transfers') as StockTransfer[];
               if (dbTransfers && dbTransfers.length > 0) {
                  console.log(`✅ [WarehouseManager] Found ${dbTransfers.length} transfers in DB. Syncing up...`);
                  onUpdateTransfers(dbTransfers);
               } else {
                  console.log('⚠️ [WarehouseManager] No transfers found in DB either.');
               }
            } catch (e) {
               console.error('❌ [WarehouseManager] Error fetching transfers from DB:', e);
            }
         } else {
            console.log(`ℹ️ [WarehouseManager] Loaded with ${transfers.length} transfers from props.`);
         }
      };

      // Delay slightly to allow main thread to settle
      setTimeout(loadTransfers, 500);
   }, []); // Run once on mount

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
   const [isSaving, setIsSaving] = useState(false);
   const [showProActions, setShowProActions] = useState(false);
   const [successTransfer, setSuccessTransfer] = useState<StockTransfer | null>(null);

   // Reception State
   const [receptionQuantities, setReceptionQuantities] = useState<Record<string, number>>({});
   const [discrepancyModal, setDiscrepancyModal] = useState<{
      transferId: string;
      items: { productId: string; productName: string; sent: number; received: number }[];
   } | null>(null);

   const [breakdownData, setBreakdownData] = useState<{ product: Product, warehouseId: string } | null>(null);
   const [activeTracking, setActiveTracking] = useState<any[]>([]);

   // Inventory State
   const [auditWarehouseId, setAuditWarehouseId] = useState<string | null>(null);
   const [showAuditSelector, setShowAuditSelector] = useState(false);
   const [productSearch, setProductSearch] = useState('');
   const [selectedCategory, setSelectedCategory] = useState<string>('Todas');

   const categories = useMemo(() => {
      const cats = new Set(products.map(p => p.category).filter(Boolean));
      return ['Todas', ...Array.from(cats)].sort();
   }, [products]);

   const filteredProductsList = useMemo(() => {
      return products.filter(p => {
         const matchesSearch = (p.name || '').toLowerCase().includes(productSearch.toLowerCase()) ||
            (p.barcode || '').includes(productSearch);
         const matchesCategory = selectedCategory === 'Todas' || p.category === selectedCategory;
         return matchesSearch && matchesCategory;
      });
   }, [products, productSearch, selectedCategory]);

   const handleAuditCommit = async (adjustments: { productId: string; newStock: number }[]) => {
      const now = new Date().toISOString();
      const sessionItems = adjustments.map(adj => {
         const product = products.find(p => p.id === adj.productId);
         return {
            productId: adj.productId,
            productName: product?.name || 'Unknown',
            systemQty: product?.stock || 0,
            countedQty: adj.newStock,
            difference: adj.newStock - (product?.stock || 0)
         };
      });

      const session = {
         id: `SESSION-${Date.now()}`,
         warehouseId: config.inventoryScope?.defaultSalesWarehouseId || 'wh_central',
         warehouseName: 'Principal',
         createdAt: now,
         finalizedAt: now,
         status: 'FINALIZED' as const,
         createdBy: currentUser?.id || 'POS-MASTER',
         createdByName: currentUser?.name || 'Terminal Maestra',
         items: sessionItems,
         syncStatus: 'PENDING' as const,
         updatedAt: now
      };

      // Save to inventoryCounts so it appears in Audit history
      await db.saveDocument('inventoryCounts' as any, session);

      // Map adjustments for onAdjustStock
      const normalizedAdjustments = adjustments.map(adj => {
         const current = products.find(p => p.id === adj.productId)?.stock || 0;
         return {
            productId: adj.productId,
            quantity: adj.newStock - current
         };
      });

      onAdjustStock(normalizedAdjustments);
      setAuditWarehouseId(null);
      alert("Inventario actualizado y sesión de auditoría registrada.");
   };

   const renderInventoryList = () => (
      <div className="animate-in fade-in slide-in-from-right-4 pb-20 flex flex-col h-full">
         <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-gray-800">Inventario Actual</h2>
            <button
               onClick={() => {
                  if (warehouses.length === 1) {
                     setAuditWarehouseId(warehouses[0].id);
                  } else {
                     setShowAuditSelector(true);
                  }
               }}
               className="px-6 py-3 bg-blue-600 text-white rounded-xl font-bold shadow-lg hover:bg-blue-500 transition-all flex items-center gap-2"
            >
               <ScanBarcode size={20} />
               Hacer Auditoría (Ajuste Manual)
            </button>
         </div>

         <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex-1 flex flex-col">
            <div className="p-4 border-b border-gray-100 bg-gray-50/50">
               <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                  <input
                     type="text"
                     placeholder="Filtrar por nombre o código..."
                     value={productSearch}
                     onChange={(e) => setProductSearch(e.target.value)}
                     className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
               </div>

               <div className="flex gap-2 p-3 overflow-x-auto no-scrollbar border-t border-gray-100">
                  {categories.map(cat => (
                     <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={`px-3 py-1 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${selectedCategory === cat
                           ? 'bg-blue-600 text-white shadow-sm'
                           : 'bg-white text-gray-500 border border-gray-100 h-8 flex items-center'
                           }`}
                     >
                        {cat}
                     </button>
                  ))}
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
                     {filteredProductsList.map((p, idx) => (
                        <tr key={p.id || `inv-${idx}`} className="hover:bg-gray-50">
                           <td className="p-4">
                              <div className="font-bold text-gray-800">{p.name}</div>
                              <div className="text-xs text-gray-400 font-mono">{p.barcode || 'N/A'}</div>
                           </td>
                           <td className="p-4 text-gray-600">
                              <span className="px-2 py-1 bg-gray-100 rounded-lg text-xs font-bold">{p.category}</span>
                           </td>
                           <td className="p-4 text-center">
                              <span className={`font-bold ${(p.stock || 0) <= (p.minStock || 0) ? 'text-red-600 bg-red-50 px-2 py-1 rounded' : 'text-gray-800'
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
      const sourceValidation = validateWarehouseAccess(product, sourceId);
      if (!sourceValidation.isValid) {
         const whName = warehouses.find(w => w.id === sourceId)?.name || 'Origen';
         alert(`Operación denegada:\n\nEl artículo "${product.name}" no está habilitado para operar en el almacén de origen (${whName}).\n\nPor favor, active el almacén en la ficha del producto.`);
         return;
      }

      // Validation: Check if product is active in Destination Warehouse
      const destValidation = validateWarehouseAccess(product, destId);
      if (!destValidation.isValid) {
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
      const sourceId = newTransfer.sourceWarehouseId;
      const product = products.find(p => p.id === productId);
      const sourceStock = product?.stockBalances?.[sourceId || ''] || 0;

      if (qty > sourceStock) {
         // Silently clamp it or show alert? Requirement says: "Impedir que el usuario escriba una cantidad mayor al 'Stock Físico'"
         // We'll alert and set to max available if they try to go over.
         alert(`Stock insuficiente en Origen (Max: ${sourceStock})`);
         qty = sourceStock;
      }

      setNewTransfer(prev => ({
         ...prev,
         items: prev.items?.map(i => i.productId === productId ? { ...i, quantity: Math.max(1, qty) } : i)
      }));
   };

   const handleSuggestReplenishment = () => {
      const destId = newTransfer.destinationWarehouseId;
      const sourceId = newTransfer.sourceWarehouseId;

      if (!destId || !sourceId) {
         alert("Selecciona origen y destino primero.");
         return;
      }

      const suggestedItems: StockTransferItem[] = [];

      products.forEach(p => {
         const settings = p.warehouseSettings?.[destId];
         if (!settings || settings.min === undefined || settings.max === undefined) return;

         const currentDestStock = p.stockBalances?.[destId] || 0;
         const currentSourceStock = p.stockBalances?.[sourceId] || 0;

         if (currentDestStock < settings.min) {
            const needed = settings.max - currentDestStock;
            const available = Math.min(needed, currentSourceStock);

            if (available > 0) {
               suggestedItems.push({
                  productId: p.id,
                  productName: p.name,
                  quantity: available
               });
            }
         }
      });

      if (suggestedItems.length === 0) {
         alert("No se encontraron productos que requieran reposición según los niveles configurados y stock disponible en origen.");
         return;
      }

      setNewTransfer(prev => ({
         ...prev,
         items: suggestedItems
      }));
   };

   const handleLoadByCategory = (categoryId: string) => {
      if (!categoryId) return;
      const sourceId = newTransfer.sourceWarehouseId;
      if (!sourceId) {
         alert("Selecciona almacén de origen primero.");
         return;
      }

      const categoryItems = products
         .filter(p => p.category === categoryId && (p.stockBalances?.[sourceId] || 0) > 0)
         .map(p => ({
            productId: p.id,
            productName: p.name,
            quantity: 1 // Default to 1, user can adjust
         }));

      if (categoryItems.length === 0) {
         alert("No se encontraron productos con stock en esta categoría.");
         return;
      }

      setNewTransfer(prev => ({
         ...prev,
         items: [...(prev.items || []), ...categoryItems.filter(ci => !prev.items?.some(i => i.productId === ci.productId))]
      }));
   };

   // STEP 1: SEND (Deduct from Source)
   const handleConfirmTransfer = async () => {
      try {
         console.log('🚀 [WarehouseManager] Iniciando Confirmación de Traspaso');
         const sourceId = newTransfer.sourceWarehouseId;
         const destId = newTransfer.destinationWarehouseId;
         const items = newTransfer.items;

         if (!sourceId || !destId || !items || items.length === 0) {
            alert('⚠️ Información Incompleta: Asegúrese de haber seleccionado el Almacén de Origen, Destino y al menos un producto.');
            console.warn('⚠️ Falta información para el traspaso:', { sourceId, destId, itemsCount: items?.length });
            return;
         }

         // Validation: Check if terminal has TRANSFER document series assigned
         const currentTerminalId = terminalId || config.terminals?.[0]?.id || 'T1';
         console.log('📍 [WarehouseManager] Contexto de Terminal:', currentTerminalId);
         const validation = validateTerminalDocument(config, currentTerminalId, 'TRANSFER');

         console.log('📍 [WarehouseManager] Paso 1: Validación de documento...', validation);

         if (!validation.isValid) {
            console.warn('❌ [WarehouseManager] Validación fallida:', validation.error);
            alert(validation.error);
            return;
         }

         // 1. Get Terminal and Series Information
         const terminal = (config.terminals || []).find(t => t.id === terminalId) || (config.terminals || [])[0];
         if (!terminal) {
            console.error('❌ [WarehouseManager] Terminal no encontrada');
            alert('Error: No se encontró una terminal activa.');
            return;
         }
         console.log('📍 [WarehouseManager] Paso 2: Terminal encontrada', terminal.id);

         const seriesId = terminal.config.documentAssignments?.['TRANSFER'];
         if (!seriesId) {
            console.error('❌ [WarehouseManager] Sin asignación de serie para TRANSFER');
            alert(validation.error || 'Error: No hay serie asignada para traspasos.');
            return;
         }

         let series = terminal.config.documentSeries?.find(s => s.id === seriesId);

         // --- SELF-HEALING / FALLBACK LOGIC ---
         if (!series) {
            console.warn(`⚠️ [WarehouseManager] Serie ${seriesId} no encontrada en config local. Buscando en globales...`);

            // Try to find in the passed props (internalSequences usually contains the series definitions in this app's hybrid state, or we fetch from DB)
            // Note: internalSequences prop is actually an array of DocumentSeries in this specific component's usage context? 
            // Let's check imports. No, internalSequences prop seems to be the *values* (nextNumber), but sometimes mixed.
            // Let's try to fetch from DB directly if not found, or assume the user needs to fix it.

            // Actually, let's look at how we can recover. If we have access to the full list of series (we don't in this component's props explicitly, only sequences), we are stuck.
            // BUT, we can try to rely on the sequence logic below.
            // The error happens because we need `series.prefix` and `series.nextNumber` from the series definition object.

            // TEMPORARY FALLBACK: Construct a "Phantom" series if we simply can't find it, to allow the transaction to proceed 
            // if and only if we can find a matching sequence.

            const existingSequence = internalSequences.find((seq: any) => seq.seriesId === seriesId && seq.terminalId === currentTerminalId);

            if (existingSequence) {
               console.log('✅ [WarehouseManager] Auto-recuperación: Se encontró secuencia existente, reconstruyendo serie temporal.');
               series = {
                  id: seriesId,
                  documentType: 'TRANSFER',
                  name: 'Traspaso (Recuperado)',
                  description: 'Auto-generated fallback',
                  prefix: 'TRA', // Fallback prefix
                  nextNumber: existingSequence.currentNumber || 1,
                  padding: 8,
                  icon: 'ArrowRightLeft',
                  color: 'blue'
               } as any;
            }
         }

         if (!series) {
            console.error('❌ [WarehouseManager] Serie no encontrada en config:', seriesId);
            alert(`🚫 ERROR DE CONFIGURACIÓN\n\nLa terminal intenta usar una serie de documentos que no existe (ID: ${seriesId}).\n\nSOLUCIÓN AUTOMÁTICA FALLÓ.\n\nPor favor vaya a Ajustes > Terminales y re-guarde la configuración de documentos.`);
            return;
         }
         console.log('📍 [WarehouseManager] Paso 3: Serie válida', series);

         // Find or create sequence for this series
         console.log('📍 [WarehouseManager] Paso 4: Buscando secuencia...');
         let sequence = internalSequences.find((seq: any) => seq.seriesId === series.id && seq.terminalId === currentTerminalId);
         if (!sequence) {
            console.log('📍 [WarehouseManager] Secuencia no encontrada, inicializando virtualmente...');
            sequence = {
               id: `seq_${series.id}_${currentTerminalId}`,
               seriesId: series.id,
               terminalId: currentTerminalId,
               currentNumber: series.nextNumber || 1
            };
         }
         console.log('📍 [WarehouseManager] Paso 5: Secuencia lista', sequence);

         const nextNumber = sequence.currentNumber;
         const displayId = `${series.prefix || ''}${String(nextNumber).padStart(series.padding || 8, '0')}`;

         // 2. Create Transfer Record (IN_TRANSIT)
         const transferRecord: StockTransfer = {
            id: `TR-${Date.now()}`,
            seriesId: series.id,
            seriesNumber: nextNumber,
            displayId: displayId,
            sourceWarehouseId: sourceId,
            destinationWarehouseId: destId,
            items: items,
            status: 'IN_TRANSIT',
            createdAt: new Date().toISOString(),
            sentAt: new Date().toISOString(),
            createdBy: 'Usuario Actual', // In real app, use user ID
            terminalId: currentTerminalId,
            syncStatus: 'PENDING',
            updatedAt: new Date().toISOString()
         };

         // 3. Update Product Stocks (Only Deduct Source)
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


         // Update sequence for next transfer
         const updatedSequences = internalSequences.map((seq: any) =>
            seq.seriesId === series.id && seq.terminalId === currentTerminalId
               ? { ...seq, currentNumber: nextNumber + 1 }
               : seq
         );

         // If sequence didn't exist, add it
         if (!internalSequences.some((seq: any) => seq.seriesId === series.id && seq.terminalId === currentTerminalId)) {
            updatedSequences.push({
               id: `seq_${series.id}_${currentTerminalId}`,
               seriesId: series.id,
               terminalId: currentTerminalId,
               currentNumber: nextNumber + 1
            });
         }

         setIsSaving(true);
         console.log('💾 [WarehouseManager] 1/4 Actualizando Productos (Optimizado)...');

         // OPTIMIZATION: Save ONLY the modified products to avoid network flood
         // We identify which products changed stock
         const modifiedProductIds = new Set(items.map(i => i.productId));
         const modifiedProducts = updatedProducts.filter(p => modifiedProductIds.has(p.id));

         console.log(`⚡️ Saving ${modifiedProducts.length} changed products individually...`);
         await Promise.all(modifiedProducts.map(p => db.saveDocument('products', p)));

         console.log('💾 [WarehouseManager] 2/4 Guardando Traspaso (Optimizado)...');
         await db.saveDocument('transfers', transferRecord);

         // VERIFICATION STEP
         console.log('🔍 [WarehouseManager] Verificando persistencia del traspaso...');
         try {
            // Wait 500ms for FS flush
            await new Promise(resolve => setTimeout(resolve, 500));
            const verify = await db.getDocument('transfers', transferRecord.id);
            if (!verify) {
               throw new Error('VERIFICATION_FAILED: El documento no se encuentra en el servidor tras guardar.');
            }
            console.log('✅ [WarehouseManager] Persistencia verificada correctamente.');
         } catch (verifyError) {
            console.error('❌ [WarehouseManager] Falló la verificación de guardado:', verifyError);
            alert('ADVERTENCIA: El sistema reportó éxito al guardar, pero no se pudo verificar el documento. Es posible que no aparezca en el historial inmediatamente.');
            // We continue, as it might just be a read lag, but user is warned.
         }

         console.log('💾 [WarehouseManager] 3/4 Actualizando Secuencias (Optimizado)...');
         // Find the specific sequence we modified
         const modifiedSequence = updatedSequences.find((seq: any) => seq.seriesId === series.id && seq.terminalId === currentTerminalId);
         if (modifiedSequence) {
            await db.saveDocument('internalSequences', modifiedSequence);
         }

         // 4. Record Inventory Ledger (Deduction from Source)
         console.log('💾 [WarehouseManager] 4/4 Registrando Movimientos en Kardex...');
         const movements = items.map(item => ({
            warehouseId: sourceId,
            productId: item.productId,
            concept: 'TRASPASO_SALIDA' as LedgerConcept,
            documentRef: displayId,
            qty: -item.quantity,
            movementCost: products.find(p => p.id === item.productId)?.cost || 0,
            terminalId: currentTerminalId
         }));

         await db.recordInventoryMovements(movements);
         console.log('✅ [WarehouseManager] Todo guardado exitosamente.');

         // Reset & Go to History
         setIsTransferMode(false);
         setNewTransfer({ items: [] });
         setSuccessTransfer(transferRecord);
         // Note: We don't auto-reload here, we let the modal do it.
      } catch (error) {
         console.error('❌ [WarehouseManager] Error crítico en traspaso:', error);
         alert(`Error crítico al procesar el traspaso: ${error instanceof Error ? error.message : 'Error desconocido'}`);
      } finally {
         setIsSaving(false);
      }
   };

   // STEP 2: RECEIVE (Add to Destination)
   const handleReceiveTransfer = async (transferId: string, discrepancyReason?: string) => {
      const transfer = transfers.find(t => t.id === transferId);
      if (!transfer || transfer.status !== 'IN_TRANSIT') return;

      const itemsToProcess = transfer.items.map(item => ({
         ...item,
         receivedQuantity: receptionQuantities[item.productId] ?? item.quantity
      }));

      // Find discrepancies
      const missingItems = itemsToProcess.filter(i => i.receivedQuantity < i.quantity);

      if (missingItems.length > 0 && !discrepancyReason) {
         setDiscrepancyModal({
            transferId,
            items: missingItems.map(m => ({
               productId: m.productId,
               productName: m.productName,
               sent: m.quantity,
               received: m.receivedQuantity
            }))
         });
         return;
      }

      console.log('📦 [WarehouseManager] Recibiendo traspaso:', transferId, discrepancyReason ? `con discrepancia: ${discrepancyReason}` : 'completo');

      // 1. Update Product Stocks (Add to Destination)
      const updatedProducts = products.map(p => {
         const processItem = itemsToProcess.find(i => i.productId === p.id);
         if (processItem) {
            const currentDest = p.stockBalances?.[transfer.destinationWarehouseId] || 0;
            return {
               ...p,
               stockBalances: {
                  ...p.stockBalances,
                  [transfer.destinationWarehouseId]: currentDest + processItem.receivedQuantity
               }
            };
         }
         return p;
      });

      // 2. Update Transfer Status
      const updatedTransfer: StockTransfer = {
         ...transfer,
         status: 'COMPLETED',
         items: itemsToProcess,
         receivedAt: new Date().toISOString(),
         syncStatus: 'PENDING',
         updatedAt: new Date().toISOString(),
         discrepancyReason: discrepancyReason
      };

      try {
         const affectedProducts = updatedProducts.filter(p => itemsToProcess.some(i => i.productId === p.id));

         console.log(`💾 [WarehouseManager] Guardando ${affectedProducts.length} productos afectados...`);
         for (const p of affectedProducts) {
            await db.saveDocument('products', p);
         }

         console.log(`💾 [WarehouseManager] Actualizando estado de traspaso ${transferId}...`);
         await db.saveDocument('transfers', updatedTransfer);

         // 3. Record Inventory Ledger
         const currentTerminalId = terminalId || (config.terminals || []).find(t => t.config?.currentDeviceId === (localStorage.getItem('pos_device_id') || ''))?.id || 'T1';

         const movements: any[] = [];

         itemsToProcess.forEach(item => {
            const prod = products.find(p => p.id === item.productId);
            const cost = prod?.cost || 0;

            // Movement A: Addition to Destination (Physical Received)
            movements.push({
               warehouseId: transfer.destinationWarehouseId,
               productId: item.productId,
               concept: 'TRASPASO_ENTRADA' as LedgerConcept,
               documentRef: transfer.displayId || transfer.id,
               qty: item.receivedQuantity,
               movementCost: cost,
               terminalId: currentTerminalId
            });

            // Movement B: Discrepancy Adjustment (If any)
            const missing = item.quantity - item.receivedQuantity;
            if (missing > 0) {
               movements.push({
                  warehouseId: transfer.destinationWarehouseId, // Or a virtual "Loss" warehouse, but standard is Dest with negative adjustment
                  productId: item.productId,
                  concept: 'TRASPASO_AJUSTE_DIFERENCIA' as LedgerConcept,
                  documentRef: transfer.displayId || transfer.id,
                  qty: -missing, // Deduct from virtual transit effectively
                  movementCost: cost,
                  terminalId: currentTerminalId,
                  notes: `Discrepancia: ${discrepancyReason}. Enviado: ${item.quantity}, Recibido: ${item.receivedQuantity}`
               });
            }
         });

         await db.recordInventoryMovements(movements);
         console.log('✅ [WarehouseManager] Recepción guardada y ledger registrado.');

         setViewingTransfer(null);
         setDiscrepancyModal(null);
         setReceptionQuantities({});

         if (confirm(`✅ Traspaso #${transfer?.displayId || transferId} recibido correctamente ${discrepancyReason ? '(CON DIFERENCIAS)' : ''}.\n\nLa aplicación se recargará para actualizar los inventarios.`)) {
            window.location.reload();
         }
      } catch (error) {
         console.error('❌ [WarehouseManager] Error al recibir traspaso:', error);
         alert('Error al recibir el traspaso. Por favor revise la consola.');
      }
   };

   const filteredProducts = useMemo(() => {
      if (!itemSearch) return [];
      return products.filter(p =>
         (p.name || '').toLowerCase().includes(itemSearch.toLowerCase()) ||
         p.barcode?.includes(itemSearch)
      );
   }, [products, itemSearch]);

   const filteredTransfers = useMemo(() => {
      if (historyFilter === 'ALL') return transfers;
      return transfers.filter(t => t.status === historyFilter);
   }, [transfers, historyFilter]);

   const pendingCount = transfers.filter(t => t.status === 'IN_TRANSIT').length;

   return (
      <>
         <div className="flex flex-col h-full bg-gray-50 animate-in fade-in slide-in-from-right-10 duration-300">

            {/* Header */}
            <div className="bg-white px-4 md:px-8 py-4 md:py-6 border-b border-gray-200 flex flex-col gap-4 md:flex-row md:justify-between md:items-center shrink-0">
               <div>
                  <h1 className="text-xl md:text-2xl font-black text-gray-800 flex items-center gap-2">
                     <Building2 className="text-purple-600" /> Gestión de Almacenes
                  </h1>
                  <p className="text-sm text-gray-500">Configuración de ubicaciones y transferencias de stock.</p>
               </div>
               <div className="flex gap-3 self-end md:self-auto">
                  <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors">
                     <X size={24} />
                  </button>
               </div>
            </div>

            {/* Tabs */}
            <div className="bg-white border-b border-gray-200 shrink-0 px-4 md:px-8">
               <div className="flex flex-wrap gap-x-4 md:gap-x-8">
                     <button
                        onClick={() => setActiveTab('LOCATIONS')}
                        className={`shrink-0 py-4 text-[11px] md:text-sm font-bold border-b-4 transition-all whitespace-nowrap ${activeTab === 'LOCATIONS' ? 'border-purple-600 text-purple-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                     >
                        Ubicaciones
                     </button>
                     <button
                        onClick={() => setActiveTab('TRANSFERS')}
                        className={`shrink-0 py-4 text-[11px] md:text-sm font-bold border-b-4 transition-all whitespace-nowrap ${activeTab === 'TRANSFERS' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                     >
                        Nuevo Traspaso
                     </button>
                     <button
                        onClick={() => setActiveTab('HISTORY')}
                        className={`shrink-0 py-4 text-[11px] md:text-sm font-bold border-b-4 transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === 'HISTORY' ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                     >
                        Historial y Recepción
                        {pendingCount > 0 && (
                           <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">{pendingCount}</span>
                        )}
                     </button>
                     <button
                        onClick={() => setActiveTab('OPTIMIZER')}
                        className={`shrink-0 py-4 text-[11px] md:text-sm font-bold border-b-4 transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === 'OPTIMIZER' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                     >
                        <Zap size={18} /> Optimización
                     </button>
                     <button
                        onClick={() => setActiveTab('FORECASTING')}
                        className={`shrink-0 py-4 text-[11px] md:text-sm font-bold border-b-4 transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === 'FORECASTING' ? 'border-amber-600 text-amber-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                     >
                        <ShoppingBag size={18} /> Reabastecimiento
                     </button>
                     <button
                        onClick={() => setActiveTab('INVENTORY')}
                        className={`shrink-0 py-4 text-[11px] md:text-sm font-bold border-b-4 transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === 'INVENTORY' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                     >
                        <Package size={18} /> Inventario
                     </button>
                     <button
                        onClick={() => setActiveTab('AUDIT_CLOSURE')}
                        className={`shrink-0 py-4 text-[11px] md:text-sm font-bold border-b-4 transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === 'AUDIT_CLOSURE' ? 'border-emerald-600 text-emerald-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                     >
                        <ClipboardList size={18} /> Auditoría & Cierre
                     </button>
               </div>
            </div>

            <div className="flex-1 overflow-hidden p-4 md:p-8">

               {/* --- INVENTORY LIST TAB --- */}
               {activeTab === 'INVENTORY' && renderInventoryList()}

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
                           <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col md:flex-row gap-6 items-center flex-wrap">
                              <div className="flex-1 min-w-[300px] w-full">
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
                              <div className="text-gray-300 hidden md:block">
                                 <ArrowRight size={24} />
                              </div>
                              <div className="flex-1 min-w-[300px] w-full">
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

                              <div className="w-full lg:w-auto flex gap-3 mt-2 lg:mt-0">
                                 <button
                                    onClick={handleSuggestReplenishment}
                                    className="px-4 py-2 border-2 border-purple-200 text-purple-600 rounded-xl font-bold flex items-center gap-2 hover:bg-purple-50 transition-all text-sm whitespace-nowrap"
                                    title="Sugerir productos según stock mínimo/máximo"
                                 >
                                    <Sparkles size={18} /> Sugerir Reposición
                                 </button>

                                 <div className="relative">
                                    <button
                                       onClick={() => setShowProActions(!showProActions)}
                                       className="px-4 py-2 bg-gray-800 text-white rounded-xl font-bold flex items-center gap-2 hover:bg-gray-900 transition-all text-sm whitespace-nowrap"
                                    >
                                       <LayoutGrid size={18} /> Acciones Pro <ChevronDown size={14} />
                                    </button>

                                    {showProActions && (
                                       <div className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-2xl border border-gray-100 z-50 p-2 overflow-hidden animate-in zoom-in-95 duration-200">
                                          <button
                                             onClick={() => {
                                                const cat = prompt("Ingrese el nombre de la categoría:");
                                                if (cat) handleLoadByCategory(cat);
                                                setShowProActions(false);
                                             }}
                                             className="w-full p-3 text-left hover:bg-gray-50 rounded-xl text-xs font-bold text-gray-600 flex items-center gap-2"
                                          >
                                             <Filter size={14} /> Cargar por Categoría
                                          </button>
                                          <button
                                             onClick={() => {
                                                alert("Carga por Temporada estará disponible pronto.");
                                                setShowProActions(false);
                                             }}
                                             className="w-full p-3 text-left hover:bg-gray-50 rounded-xl text-xs font-bold text-gray-600 flex items-center gap-2"
                                          >
                                             <Calendar size={14} /> Cargar por Temporada
                                          </button>
                                       </div>
                                    )}
                                 </div>
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
                                    {filteredProducts.map(p => {
                                       const srcStock = p.stockBalances?.[newTransfer.sourceWarehouseId || ''] || 0;
                                       const dstStock = p.stockBalances?.[newTransfer.destinationWarehouseId || ''] || 0;
                                       return (
                                          <div
                                             key={p.id}
                                             onClick={() => addItemToTransfer(p)}
                                             className="p-3 hover:bg-gray-50 rounded-xl cursor-pointer flex justify-between items-center group transition-colors"
                                          >
                                             <div>
                                                <p className="font-bold text-gray-800 text-sm">{p.name}</p>
                                                <div className="flex items-center gap-2 mt-1">
                                                   <p className="text-xs text-gray-400 font-mono pr-2 border-r border-gray-200">{p.barcode}</p>
                                                   <span className="text-[10px] font-bold px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">
                                                      Origen: {srcStock}
                                                   </span>
                                                   <span className="text-[10px] font-bold px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">
                                                      Destino: {dstStock}
                                                   </span>
                                                </div>
                                             </div>
                                             <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                {(p.operationalFlags?.usesLots || p.operationalFlags?.usesSerial) && (
                                                   <button
                                                      onClick={(e) => {
                                                         e.stopPropagation();
                                                         setBreakdownData({ product: p, warehouseId: newTransfer.sourceWarehouseId || 'wh_central' });
                                                         db.get('inventoryTracking').then((all: any) => {
                                                            const filtered = (all || []).filter((t: any) =>
                                                               t.productId === p.id &&
                                                               t.warehouseId === (newTransfer.sourceWarehouseId || 'wh_central') &&
                                                               t.status === 'AVAILABLE'
                                                            );
                                                            setActiveTracking(filtered);
                                                         });
                                                      }}
                                                      className="p-2 bg-purple-50 text-purple-600 rounded-lg hover:bg-purple-100"
                                                      title="Ver Desglose de Lotes/Series"
                                                   >
                                                      <Eye size={16} />
                                                   </button>
                                                )}
                                                <button className="p-2 bg-gray-100 text-blue-600 rounded-lg">
                                                   <Plus size={16} />
                                                </button>
                                             </div>
                                          </div>
                                       );
                                    })}
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
                                             <div className="flex items-center gap-2 mt-2">
                                                <div className="flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                                                   <button
                                                      onClick={() => updateItemQuantity(item.productId, item.quantity - 1)}
                                                      className="p-2 hover:bg-gray-50 text-gray-400 hover:text-gray-600"
                                                   >
                                                      <Minus size={14} />
                                                   </button>
                                                   <input
                                                      type="number"
                                                      value={item.quantity}
                                                      onChange={(e) => updateItemQuantity(item.productId, parseInt(e.target.value) || 0)}
                                                      className="w-12 text-center text-sm font-bold outline-none bg-transparent"
                                                   />
                                                   <button
                                                      onClick={() => updateItemQuantity(item.productId, item.quantity + 1)}
                                                      className="p-2 hover:bg-gray-50 text-gray-400 hover:text-gray-600"
                                                   >
                                                      <Plus size={14} />
                                                   </button>
                                                </div>
                                                <span className="text-[10px] text-gray-400 font-bold uppercase">Unds</span>
                                             </div>
                                          </div>
                                          <button onClick={() => removeItemFromTransfer(item.productId)} className="text-gray-400 hover:text-red-500 p-2">
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
                                       className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl shadow-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                       disabled={isSaving || !newTransfer.items?.length || !newTransfer.sourceWarehouseId || !newTransfer.destinationWarehouseId}
                                    >
                                       {isSaving ? (
                                          <>
                                             <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                             Guardando...
                                          </>
                                       ) : (
                                          'Confirmar Envío'
                                       )}
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
                              {/* DEBUG SECTION */}
                              <div className="mt-8 p-4 bg-gray-100 rounded text-xs text-left font-mono">
                                 <p className="font-bold text-red-500">DEBUG INFO:</p>
                                 <p>Transfers in Prop: {transfers?.length || 0}</p>
                                 <p>Filter Mode: {historyFilter}</p>
                                 <p>Statuses in Prop:</p>
                                 <ul className="list-disc pl-4">
                                    {Array.from(new Set(transfers?.map(t => t.status) || [])).map(s => (
                                       <li key={s}>{s}</li>
                                    ))}
                                 </ul>
                              </div>
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
                                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${isPending
                                             ? 'bg-orange-100 text-orange-700'
                                             : t.discrepancyReason
                                                ? 'bg-amber-100 text-amber-700'
                                                : 'bg-green-100 text-green-700'
                                             }`}>
                                             {isPending ? 'En Tránsito (Pendiente)' : t.discrepancyReason ? 'Recibido (Con Diferencia)' : 'Completado'}
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
                                          {(t.items || []).slice(0, 3).map(i => (
                                             <div key={i.productId} className="w-8 h-8 rounded-full bg-gray-100 border-2 border-white flex items-center justify-center text-[10px] font-bold text-gray-600" title={i.productName}>
                                                {i.quantity}
                                             </div>
                                          ))}
                                          {(t.items || []).length > 3 && (
                                             <div className="w-8 h-8 rounded-full bg-gray-200 border-2 border-white flex items-center justify-center text-[10px] font-bold text-gray-600">
                                                +{(t.items || []).length - 3}
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

               {/* --- OPTIMIZER TAB --- */}
               {activeTab === 'OPTIMIZER' && (
                  <InventoryOptimizer
                     products={products}
                     warehouses={warehouses}
                     transactions={[]} // TODO: Fetch from DB if needed, or pass from App.tsx
                     suppliers={suppliers}
                     config={config}
                     onUpdateProducts={onUpdateProducts}
                  />
               )}

               {activeTab === 'FORECASTING' && (
                  <SmartReplenishment
                     products={products}
                     warehouses={warehouses}
                     suppliers={suppliers}
                     purchaseOrders={purchaseOrders}
                     parkedTickets={parkedTickets}
                     config={config}
                     onOrdersGenerated={(newOrders) => {
                        // Notify refresh
                        window.dispatchEvent(new CustomEvent('reFreshWarehouseData'));
                     }}
                  />
               )}

               {activeTab === 'AUDIT_CLOSURE' && (
                  <InventoryAuditClosure
                     warehouses={warehouses}
                     products={products}
                     config={config}
                     currentUser={currentUser}
                     roles={roles}
                     terminalId={terminalId}
                  />
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
                        {(viewingTransfer.items || []).map((item, idx) => {
                           const isPending = viewingTransfer.status === 'IN_TRANSIT';
                           const currentVal = receptionQuantities[item.productId] ?? item.quantity;

                           return (
                              <div key={idx} className="flex justify-between items-center p-3 border border-gray-100 rounded-xl hover:bg-gray-50">
                                 <span className="font-medium text-gray-700 text-sm">{item.productName}</span>
                                 {isPending ? (
                                    <div className="flex items-center gap-2">
                                       <input
                                          type="number"
                                          value={currentVal}
                                          max={item.quantity}
                                          min={0}
                                          onChange={(e) => {
                                             const val = parseInt(e.target.value) || 0;
                                             if (val > item.quantity) {
                                                alert(`No puede recibir más de lo enviado (${item.quantity}).`);
                                                return;
                                             }
                                             setReceptionQuantities(prev => ({ ...prev, [item.productId]: val }));
                                          }}
                                          className="w-16 p-1 text-center bg-gray-50 border border-gray-200 rounded-lg text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none"
                                       />
                                       <span className="text-[10px] font-bold text-gray-400 uppercase">/ {item.quantity}</span>
                                    </div>
                                 ) : (
                                    <div className="flex items-center gap-2">
                                       <span className="font-bold text-gray-900 bg-gray-100 px-2 py-1 rounded-lg text-sm">
                                          {item.receivedQuantity ?? item.quantity}
                                       </span>
                                       {item.receivedQuantity !== undefined && item.receivedQuantity < item.quantity && (
                                          <span className="text-[10px] font-bold text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded">
                                             -{item.quantity - item.receivedQuantity}
                                          </span>
                                       )}
                                    </div>
                                 )}
                              </div>
                           );
                        })}
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

            {/* Success Modal with QR */}
            {successTransfer && (
               <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                  <div className="bg-white rounded-[40px] shadow-2xl max-w-md w-full p-8 text-center animate-in zoom-in-95 duration-300">
                     <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                        <Check size={40} />
                     </div>
                     <h2 className="text-2xl font-black text-gray-800 mb-2">Traspaso Enviado</h2>
                     <p className="text-gray-500 mb-8 text-sm">El cargo se ha descontado del origen y está listo para ser recibido.</p>

                     <div className="bg-gray-50 p-6 rounded-3xl border border-gray-100 mb-8 flex flex-col items-center">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4">Código de Recepción</p>
                        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 mb-4">
                           <img
                              src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${successTransfer.displayId}`}
                              alt="QR Code"
                              className="w-32 h-32"
                           />
                        </div>
                        <p className="text-xl font-black text-gray-800 font-mono tracking-tighter">
                           {successTransfer.displayId}
                        </p>
                     </div>

                     <button
                        onClick={() => window.location.reload()}
                        className="w-full py-4 bg-gray-800 text-white rounded-2xl font-bold shadow-xl hover:bg-gray-900 transition-all active:scale-95"
                     >
                        Entendido, Finalizar
                     </button>
                  </div>
               </div>
            )}

            {/* Discrepancy Confirmation Modal */}
            {discrepancyModal && (
               <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
                  <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                     <div className="p-6 border-b border-gray-100 bg-amber-50">
                        <div className="flex items-center gap-3">
                           <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center">
                              <AlertTriangle size={24} />
                           </div>
                           <div>
                              <h3 className="font-bold text-lg text-gray-800">Gestión de Diferencias</h3>
                              <p className="text-xs text-gray-500">La cantidad recibida no coincide con el envío</p>
                           </div>
                        </div>
                     </div>

                     <div className="p-6 space-y-4">
                        <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                           <p className="text-xs font-bold text-gray-400 uppercase mb-2">Productos Faltantes</p>
                           {discrepancyModal.items.map((item, idx) => (
                              <div key={idx} className="flex justify-between items-center py-2 border-b border-gray-200 last:border-0">
                                 <span className="text-sm font-medium text-gray-700">{item.productName}</span>
                                 <div className="flex items-center gap-2">
                                    <span className="text-xs text-gray-400">Enviado: {item.sent}</span>
                                    <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded">
                                       Recibido: {item.received}
                                    </span>
                                    <span className="text-xs font-bold text-red-600 bg-red-50 px-2 py-1 rounded">
                                       Faltante: {item.sent - item.received}
                                    </span>
                                 </div>
                              </div>
                           ))}
                        </div>

                        <div>
                           <label className="block text-xs font-bold text-gray-500 uppercase mb-2">
                              Motivo de la Diferencia <span className="text-red-500">*</span>
                           </label>
                           <select
                              id="discrepancy-reason"
                              className="w-full p-3 bg-white border-2 border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-amber-500 font-bold text-gray-700"
                              defaultValue=""
                           >
                              <option value="" disabled>-- Seleccionar --</option>
                              <option value="DAMAGE">Daño en Transporte</option>
                              <option value="DISPATCH_ERROR">Error de Despacho</option>
                              <option value="LOSS_THEFT">Pérdida/Robo</option>
                           </select>
                        </div>
                     </div>

                     <div className="p-6 border-t border-gray-100 bg-gray-50 flex gap-3">
                        <button
                           onClick={() => {
                              setDiscrepancyModal(null);
                              setReceptionQuantities({});
                           }}
                           className="flex-1 py-3 text-gray-500 font-bold hover:bg-gray-200 rounded-xl transition-colors"
                        >
                           Cancelar
                        </button>
                        <button
                           onClick={() => {
                              const select = document.getElementById("discrepancy-reason") as HTMLSelectElement;
                              const reason = select?.value;
                              if (!reason) {
                                 alert("Por favor seleccione un motivo para la diferencia.");
                                 return;
                              }
                              const transferId = discrepancyModal.transferId;
                              setDiscrepancyModal(null);
                              handleReceiveTransfer(transferId, reason);
                           }}
                           className="flex-1 py-3 bg-amber-600 text-white font-bold rounded-xl shadow-md hover:bg-amber-700 active:scale-95 transition-all"
                        >
                           Confirmar Recepción
                        </button>
                     </div>
                  </div>
               </div>
            )}
         </div>

         {
            breakdownData && (
               <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4 animate-in fade-in duration-200">
                  <div className="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                     <div className="p-8 bg-gray-50 border-b border-gray-100 flex justify-between items-center">
                        <div>
                           <h2 className="text-xl font-black text-gray-800 tracking-tight">Desglose de Stock</h2>
                           <p className="text-sm font-bold text-gray-400 capitalize">{breakdownData.product.name}</p>
                        </div>
                        <button onClick={() => setBreakdownData(null)} className="p-3 bg-white hover:bg-gray-100 rounded-2xl text-gray-400">
                           <X size={24} />
                        </button>
                     </div>
                     <div className="flex-1 overflow-y-auto p-8">
                        <div className="overflow-hidden rounded-2xl border border-gray-100">
                           <table className="w-full text-left">
                              <thead className="bg-gray-50">
                                 <tr>
                                    <th className="p-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Código</th>
                                    <th className="p-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Estado</th>
                                    <th className="p-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Vence</th>
                                    <th className="p-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Creado</th>
                                 </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-50">
                                 {activeTracking.map(track => (
                                    <tr key={track.id} className="hover:bg-gray-50 transition-colors">
                                       <td className="p-4 font-bold text-gray-700">{track.trackingCode}</td>
                                       <td className="p-4">
                                          <span className="bg-green-100 text-green-700 text-[10px] font-black px-2 py-0.5 rounded-full uppercase">Disponible</span>
                                       </td>
                                       <td className="p-4 text-sm text-gray-500">{track.expirationDate || 'N/A'}</td>
                                       <td className="p-4 text-sm text-gray-400 font-mono">{new Date(track.createdAt).toLocaleDateString()}</td>
                                    </tr>
                                 ))}
                                 {activeTracking.length === 0 && (
                                    <tr>
                                       <td colSpan={4} className="p-10 text-center text-gray-400 italic text-sm">No hay registros de trazabilidad disponibles en este almacén.</td>
                                    </tr>
                                 )}
                              </tbody>
                           </table>
                        </div>
                     </div>
                  </div>
               </div>
            )}

         {showAuditSelector && (
            <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
               <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
                  <div className="p-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                     <h3 className="font-bold text-gray-800">Seleccionar Almacén</h3>
                     <button onClick={() => setShowAuditSelector(false)}><X size={20} className="text-gray-500" /></button>
                  </div>
                  <div className="p-2 max-h-[60vh] overflow-y-auto">
                     {warehouses.map(w => (
                        <button
                           key={w.id}
                           onClick={() => {
                              setAuditWarehouseId(w.id);
                              setShowAuditSelector(false);
                           }}
                           className="w-full text-left p-4 hover:bg-purple-50 rounded-xl transition-colors border-b border-gray-50 last:border-0"
                        >
                           <p className="font-bold text-gray-800">{w.name}</p>
                           <p className="text-xs text-gray-400">{w.address}</p>
                        </button>
                     ))}
                  </div>
               </div>
            </div>
         )}

         {auditWarehouseId && (
            <ErrorBoundary componentName="InventoryAudit">
               <InventoryAudit
                  warehouseId={auditWarehouseId}
                  products={products}
                  mode="ABSOLUTE"
                  onClose={() => setAuditWarehouseId(null)}
                  onCommit={handleAuditCommit}
               />
            </ErrorBoundary>
         )}
      </>
   );
};

export default WarehouseManager;
