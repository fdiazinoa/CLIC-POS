
import React, { useState, useMemo, useEffect } from 'react';
import {
   Package, Search, Plus, Edit2, Trash2, ArrowLeft,
   Filter, Tag, Image as ImageIcon, DollarSign,
   Calendar, CheckCircle2, XCircle, Layers, ClipboardList,
   ChevronDown, ChevronRight, Box, AlertCircle, MapPin, Grid, Sun,
   CheckSquare, Square, MoreHorizontal, Settings2, Activity, RefreshCw
} from 'lucide-react';
import { Product, BusinessConfig, Tariff, Transaction, ProductVariant, Warehouse, ProductGroup, Season, Watchlist, ProductStock, StockTransfer, Supplier, Room } from '../types';
import { calculateOptimalInventoryLevels } from '../utils/inventoryEngine';
import ProductForm from './ProductForm';
import TariffForm from './TariffForm';
import VariantManager from './VariantManager';
import GroupForm from './GroupForm';
import SeasonForm from './SeasonForm';
import BulkEditModal from './BulkEditModal';
import WatchlistMonitor from './WatchlistMonitor';
import { db } from '../utils/db';
import { syncManager } from '../services/sync/SyncManager';
import { permissionService } from '../services/sync/PermissionService';
import ClassificationManager from './ClassificationManager';
import { getWarehouseScopedNumber, isProductWarehouseActive } from '../utils/masterIdentity';

interface CatalogManagerProps {
   products: Product[];
   config: BusinessConfig;
   warehouses: Warehouse[];
   transactions: Transaction[];
   currentUser: any; // Using any to avoid circular dependency or import issues if User type isn't imported
   roles: any[];
   onUpdateProducts: (products: Product[]) => void;
   onUpdateConfig: (config: BusinessConfig) => void;
   onClose: () => void;
   isAdminMode?: boolean;
   terminalId?: string;
   initialProductId?: string;
   initialTab?: any;
   transfers?: StockTransfer[];
   purchaseOrders?: any[];
   suppliers?: Supplier[];
   rooms: Room[];
   onUpdateRooms: (rooms: Room[]) => void;
}

type CatalogViewMode = 'PRODUCTS' | 'TARIFFS' | 'VARIANTS' | 'STOCKS' | 'GROUPS' | 'SEASONS' | 'BI_MONITOR' | 'CLASSIFICATIONS' | 'SPACES';

// --- SUB-COMPONENT: STOCK ROW ---
const StockRow: React.FC<{ product: Product; warehouseId: string; productStocks: ProductStock[] }> = ({ product, warehouseId, productStocks }) => {
   const [isExpanded, setIsExpanded] = useState(false);
   const hasVariants = product.variants && product.variants.length > 0;

   // Get stock from detailed collection
   const detailedStock = productStocks.find(s => s.productId === product.id && s.warehouseId === warehouseId);
   const warehouseStock = detailedStock ? detailedStock.quantity : getWarehouseScopedNumber(product.stockBalances || {}, warehouseId, [], 0);

   const getStatusBadge = (qty: number) => {
      if (qty > 10) return <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full"><CheckCircle2 size={12} /> Disponible</span>;
      if (qty > 0) return <span className="inline-flex items-center gap-1 text-xs font-bold text-orange-600 bg-orange-50 px-2 py-1 rounded-full"><AlertCircle size={12} /> Bajo Stock</span>;
      return <span className="inline-flex items-center gap-1 text-xs font-bold text-red-600 bg-red-50 px-2 py-1 rounded-full"><XCircle size={12} /> Agotado</span>;
   };

   const toggleExpand = () => {
      if (hasVariants) setIsExpanded(!isExpanded);
   };

   return (
      <>
         <tr
            onClick={toggleExpand}
            className={`group border-b border-gray-100 transition-colors ${hasVariants ? 'cursor-pointer hover:bg-gray-50' : ''}`}
         >
            <td className="p-4">
               <div className="flex items-center gap-3">
                  <div className={`w-6 flex justify-center text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-90 text-blue-500' : ''}`}>
                     {hasVariants && <ChevronRight size={18} />}
                  </div>

                  <div className="w-10 h-10 rounded-lg bg-gray-100 overflow-hidden border border-gray-200 shrink-0 relative">
                     {product.image ? <img src={product.image} className="w-full h-full object-cover" /> : <ImageIcon className="m-2 text-gray-300" />}
                     {hasVariants && (
                        <div className="absolute bottom-0 right-0 bg-blue-500 text-white p-0.5 rounded-tl-md">
                           <Layers size={8} />
                        </div>
                     )}
                  </div>
                  <div>
                     <p className="font-bold text-gray-800 text-sm line-clamp-1">{product.name}</p>
                     <p className="text-xs text-gray-400 font-mono">{product.barcode || '---'}</p>
                  </div>
               </div>
            </td>
            <td className="p-4">
               {hasVariants ? (
                  <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded border border-blue-100">
                     {product.variants.length} Variantes
                  </span>
               ) : (
                  <span className="text-xs text-gray-400 italic">N/A</span>
               )}
            </td>
            <td className="p-4 text-center font-mono font-bold text-gray-700 text-sm">
               {warehouseStock}
            </td>
            <td className="p-4 text-right">
               {getStatusBadge(warehouseStock)}
            </td>
         </tr>
         {hasVariants && isExpanded && product.variants.map((variant, idx) => (
            <tr key={`${product.id}-var-${idx}`} className="bg-slate-50/80 border-b border-gray-100 animate-in slide-in-from-top-1">
               <td className="p-3 pl-16">
                  <div className="flex items-center gap-2 relative">
                     <div className="absolute -left-6 top-1/2 w-4 h-px bg-gray-300"></div>
                     <div className="absolute -left-6 -top-1/2 bottom-1/2 w-px bg-gray-300"></div>
                     <span className="font-mono text-xs text-gray-500 bg-white px-1.5 py-0.5 rounded border border-gray-200">
                        {variant.sku}
                     </span>
                  </div>
               </td>
               <td className="p-3">
                  <div className="flex gap-1 flex-wrap">
                     {Object.entries(variant.attributeValues).map(([k, v]) => (
                        <span key={k} className="text-xs text-gray-600">
                           <span className="font-bold text-gray-400">{k}:</span> {v}
                        </span>
                     ))}
                  </div>
               </td>
               <td className="p-3 text-center text-sm font-medium text-gray-600">-</td>
               <td className="p-3 text-right">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full text-gray-500 bg-gray-200`}>Ver Global</span>
               </td>
            </tr>
         ))}
      </>
   );
};

// --- WAREHOUSE CARD CONTAINER ---
const WarehouseStockCard: React.FC<{ warehouse: Warehouse; filteredProducts: Product[]; productStocks: ProductStock[] }> = ({ warehouse, filteredProducts, productStocks }) => {
   const [isCardExpanded, setIsCardExpanded] = useState(false);
   const warehouseProducts = filteredProducts.filter(p => isProductWarehouseActive(p, warehouse.id, [warehouse]));

   const totalValue = warehouseProducts.reduce((acc, p) => {
      const detailedStock = productStocks.find(s => s.productId === p.id && s.warehouseId === warehouse.id);
      const qty = detailedStock ? detailedStock.quantity : getWarehouseScopedNumber(p.stockBalances || {}, warehouse.id, [warehouse], 0);
      return acc + (qty * (p.cost || 0));
   }, 0);
   const itemCount = warehouseProducts.length;

   return (
      <div className={`bg-white rounded-2xl border transition-all overflow-hidden ${isCardExpanded ? 'shadow-lg border-emerald-300 ring-1 ring-emerald-100' : 'shadow-sm border-gray-200 hover:border-emerald-200'} ${!warehouse.allowPosSale ? 'opacity-70 border-dashed bg-gray-50' : ''}`}>
         <div className="p-6 flex flex-col md:flex-row gap-6 items-start md:items-center justify-between">
            <div className="flex items-center gap-4">
               <div className={`p-4 rounded-2xl ${warehouse.allowPosSale ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-200 text-gray-400'}`}>
                  <Box size={24} />
               </div>
               <div>
                  <div className="flex items-center gap-2">
                     <h3 className="font-bold text-lg text-gray-800">{warehouse.name}</h3>
                     {!warehouse.allowPosSale && <span className="text-[10px] font-bold bg-gray-200 text-gray-500 px-2 py-0.5 rounded">VENTA DESACTIVADA</span>}
                  </div>
                  <p className="text-sm text-gray-500 flex items-center gap-1 mt-1"><MapPin size={12} /> {warehouse.address}</p>
               </div>
            </div>
            <div className="flex items-center gap-8 w-full md:w-auto justify-between md:justify-end">
               <div className="text-right">
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Valorizado</p>
                  <p className="text-lg font-black text-gray-800">${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
               </div>
               <div className="text-right">
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Artículos</p>
                  <p className="text-lg font-black text-gray-800">{itemCount}</p>
               </div>
               <button onClick={() => setIsCardExpanded(!isCardExpanded)} className={`p-2 rounded-full border transition-colors ${isCardExpanded ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-white text-gray-400 border-gray-200 hover:bg-gray-50'}`}>
                  <ChevronDown size={20} className={isCardExpanded ? 'rotate-180 transition-transform' : ''} />
               </button>
            </div>
         </div>
         {isCardExpanded && (
            <div className="border-t border-gray-100 bg-gray-50/30 p-6 animate-in slide-in-from-top-2 duration-200">
               <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                  <table className="w-full text-left text-sm">
                     <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 font-bold text-xs uppercase">
                        <tr><th className="p-4 w-[40%]">Artículo</th><th className="p-4">Variante / Atributo</th><th className="p-4 text-center">Stock Físico</th><th className="p-4 text-right">Estado</th></tr>
                     </thead>
                     <tbody className="divide-y divide-gray-100">
                        {warehouseProducts.map(product => <StockRow key={product.id} product={product} warehouseId={warehouse.id} productStocks={productStocks} />)}
                     </tbody>
                  </table>
               </div>
            </div>
         )}
      </div>
   );
};

// --- MAIN CATALOG COMPONENT ---
const CatalogManager: React.FC<CatalogManagerProps> = ({
   products, config, warehouses, transactions, currentUser, roles, onUpdateProducts, onUpdateConfig,
   onClose,
   isAdminMode,
   terminalId,
   initialProductId,
   initialTab,
   transfers = [],
   purchaseOrders = [],
   suppliers = []
}) => {
   const [viewMode, setViewMode] = useState<CatalogViewMode>('PRODUCTS');
   const [searchTerm, setSearchTerm] = useState('');
   const [categoryFilter, setCategoryFilter] = useState('ALL');
   const [editingProduct, setEditingProduct] = useState<Product | null | 'NEW'>(null);
   const [productStocks, setProductStocks] = useState<ProductStock[]>([]);
   const [isTablet, setIsTablet] = useState(window.innerWidth >= 1024);

   // SELECTION & BULK STATE
   const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
   const [showBulkModal, setShowBulkModal] = useState(false);

   // Watchlists State
   const [watchlists, setWatchlists] = useState<Watchlist[]>([]);

   const hasPermission = (permission: string): boolean => {
      if (!currentUser) return false;
      const userRole = roles.find(r => r.id === currentUser.role);
      if (!userRole) return false;
      if (userRole.permissions.includes('ALL')) return true;
      return userRole.permissions.includes(permission);
   };

   const canManage = hasPermission('CATALOG_MANAGE');

   useEffect(() => {
      const handleResize = () => setIsTablet(window.innerWidth >= 1024);
      window.addEventListener('resize', handleResize);

      const loadWatchlists = async () => {
         const lists = (await db.get('watchlists') || []) as Watchlist[];
         setWatchlists(lists);
      };
      const loadStocks = async () => {
         const stocks = (await db.get('productStocks') || []) as ProductStock[];
         setProductStocks(stocks);
      };
      loadWatchlists();
      loadStocks();

      const handleStockUpdate = async () => {
         const stocks = (await db.get('productStocks') || []) as ProductStock[];
         setProductStocks(stocks);
      };
      window.addEventListener('productStocksUpdated', handleStockUpdate);

      // --- INITIAL PRODUCT DEEP LINKING ---
      if (initialProductId) {
         const prod = products.find(p => p.id === initialProductId);
         if (prod) {
            setEditingProduct(prod);
         }
      }

      return () => {
         window.removeEventListener('resize', handleResize);
         window.removeEventListener('productStocksUpdated', handleStockUpdate);
      };
   }, []);

   const tariffs = config.tariffs || [];
   const [editingTariff, setEditingTariff] = useState<Tariff | null | 'NEW'>(null);
   const [editingGroup, setEditingGroup] = useState<ProductGroup | null | 'NEW'>(null);
   const [editingSeason, setEditingSeason] = useState<Season | null | 'NEW'>(null);

   const categories = useMemo(() => ['ALL', ...Array.from(new Set(products.map(p => p.category)))], [products]);
   const filteredProducts = useMemo(() => {
      return products.filter(p => {
         const matchesSearch = (p.name || '').toLowerCase().includes(searchTerm.toLowerCase()) || p.barcode?.includes(searchTerm);
         const matchesCategory = categoryFilter === 'ALL' || p.category === categoryFilter;
         return matchesSearch && matchesCategory;
      });
   }, [products, searchTerm, categoryFilter]);

   const toggleSelection = (id: string) => {
      const newSet = new Set(selectedIds);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      setSelectedIds(newSet);
   };

   const toggleAllSelection = () => {
      if (selectedIds.size === filteredProducts.length) {
         setSelectedIds(new Set());
      } else {
         setSelectedIds(new Set(filteredProducts.map(p => p.id)));
      }
   };

   const handleBulkUpdate = async (changes: any) => {
      setShowBulkModal(false);

      try {
         const touchedIds = Array.from(selectedIds);
         // Call persistent bulk API instead of local state mutation
         await db.bulkUpdateProducts(
            touchedIds,
            changes,
            currentUser?.id,
            currentUser?.name
         );

         // Force refresh from database to ensure UI is in sync with server/IndexedDB
         const refreshedProducts = await db.get('products') as Product[];
         onUpdateProducts(refreshedProducts);

         for (const id of touchedIds) {
            const doc = refreshedProducts.find((p) => p.id === id);
            if (doc) {
               syncManager.broadcastChange('products', doc, 'UPDATE').catch((err) =>
                  console.warn('[CatalogManager] broadcastChange products', err)
               );
            }
         }

         setSelectedIds(new Set());

         setTimeout(() => {
            alert("Operación masiva completada con éxito.");
         }, 200);
      } catch (error: any) {
         console.error('❌ CatalogManager: Bulk update failed', error);
         alert(`Error al procesar la actualización masiva: ${error.message || 'Error desconocido'}`);
      }
   };

   const handleUpdateWatchlists = async (newLists: Watchlist[]) => {
      setWatchlists(newLists);
      await db.save('watchlists', newLists);
   };

   const handleBulkRecalculate = async (season: Season) => {
      if (!confirm(`¿Recalcular niveles mínimos y máximos para los ${season.productIds.length} productos de "${season.name}"?`)) return;

      const updatedProducts = [...products];
      let updatedCount = 0;

      for (const p of updatedProducts) {
         // Check if product is in season OR in affected category
         const isProductInSeason = season.productIds.includes(p.id);
         const isCategoryAffected = season.affectedCategories?.includes(p.category);

         if (isProductInSeason || isCategoryAffected) {
            try {
               const baselineWhId = warehouses[0]?.id || 'wh_central';
               const calc = await calculateOptimalInventoryLevels(p, baselineWhId, config.seasons || [], suppliers);
               p.minStock = calc.suggestedMin;
               // We also update warehouse-specific mins if they exist
               // For simplicity in bulk, we just set the global minStock which the system uses as default
               updatedCount++;
            } catch (err) {
               console.error(`Error calculating for ${p.id}`, err);
            }
         }
      }

      onUpdateProducts(updatedProducts);
      alert(`¡Listo! Se actualizaron ${updatedCount} productos.`);
   };

   if (viewMode === 'VARIANTS') return <VariantManager onClose={() => setViewMode('PRODUCTS')} />;
   if (editingProduct) return <ProductForm key={editingProduct === 'NEW' ? 'NEW' : editingProduct.id} initialData={editingProduct === 'NEW' ? null : editingProduct} config={config} warehouses={warehouses} availableTariffs={tariffs} hasHistory={transactions?.some(t => t.items?.some(item => item.id === (editingProduct as any).id)) ?? false} currentUser={currentUser} roles={roles} onSave={handleSaveProduct} onClose={() => setEditingProduct(null)} transfers={transfers} purchaseOrders={purchaseOrders} suppliers={suppliers} seasons={config.seasons || []} initialTab={initialTab} allProducts={products} />
   if (editingTariff) return <TariffForm initialData={editingTariff === 'NEW' ? null : editingTariff} products={products} config={config} availableTariffs={tariffs} onSave={handleSaveTariff} onUpdateProducts={onUpdateProducts} onClose={() => setEditingTariff(null)} />;
   if (editingGroup) return <GroupForm initialData={editingGroup === 'NEW' ? null : editingGroup} products={products} onSave={handleSaveGroup} onClose={() => setEditingGroup(null)} />;
   if (editingSeason) return <SeasonForm initialData={editingSeason === 'NEW' ? null : editingSeason} products={products} onSave={handleSaveSeason} onClose={() => setEditingSeason(null)} />;
   if (viewMode === 'CLASSIFICATIONS') return <ClassificationManager config={config} onUpdateConfig={onUpdateConfig} onClose={() => setViewMode('PRODUCTS')} />;

   async function handleSaveProduct(savedProduct: Product) {
      try {
         const oldProduct = products.find(p => p.id === savedProduct.id);
         const exists = !!oldProduct;

         // 1. Persist ONLY the modified product
         await db.saveDocument('products', savedProduct);

         // Update local state for UI
         const currentProducts = products;
         let updatedProductsList;
         if (exists) {
            updatedProductsList = currentProducts.map(p => p.id === savedProduct.id ? { ...p, ...savedProduct } : p);
         } else {
            updatedProductsList = [...currentProducts, savedProduct];
         }

         // Detect stock changes and record movements
         if (exists) {
            const whIds = Array.from(new Set([
               ...Object.keys(oldProduct.stockBalances || {}),
               ...Object.keys(savedProduct.stockBalances || {})
            ]));

            for (const whId of whIds) {
               const oldQty = oldProduct.stockBalances?.[whId] || 0;
               const newQty = savedProduct.stockBalances?.[whId] || 0;
               if (oldQty !== newQty) {
                  const diff = newQty - oldQty;
                  await db.recordInventoryMovement(
                     whId,
                     savedProduct.id,
                     diff > 0 ? 'AJUSTE_ENTRADA' : 'AJUSTE_SALIDA',
                     'AJUSTE MANUAL',
                     diff,
                     savedProduct.cost,
                     terminalId || 'LOCAL'
                  );
               }
            }

            // Reload from DB to get the correct stock values after movement recording (which updates products again)
            const freshProducts = await db.get('products') as Product[];
            onUpdateProducts(freshProducts || products);
         } else {
            // New product with initial stock
            for (const [whId, qty] of Object.entries(savedProduct.stockBalances || {})) {
               if (qty !== 0) {
                  await db.recordInventoryMovement(
                     whId,
                     savedProduct.id,
                     'INICIAL',
                     'CARGA INICIAL',
                     qty as number,
                     savedProduct.cost,
                     terminalId || 'LOCAL'
                  );
               }
            }

            // For new products, reload to get accurate stock after movement recording
            const freshProducts = await db.get('products') as Product[];
            onUpdateProducts(freshProducts || products);
         }
         setEditingProduct(null);

         // Broadcast change to other terminals (if master)
         syncManager.broadcastChange('products', savedProduct, exists ? 'UPDATE' : 'CREATE').catch(console.error);
      } catch (error) {
         console.error('❌ CatalogManager: Error saving product', error);
         alert('No se pudo guardar el producto. Revise la consola para más detalle.');
      }
   }

   function handleSaveTariff(savedTariff: Tariff) {
      const exists = tariffs.some(t => t.id === savedTariff.id);
      onUpdateConfig({ ...config, tariffs: exists ? tariffs.map(t => t.id === savedTariff.id ? savedTariff : t) : [...tariffs, savedTariff] });
      setEditingTariff(null);
   }

   function handleSaveGroup(savedGroup: ProductGroup) {
      const currentGroups = config.productGroups || [];
      const exists = currentGroups.some(g => g.id === savedGroup.id);
      onUpdateConfig({ ...config, productGroups: exists ? currentGroups.map(g => g.id === savedGroup.id ? savedGroup : g) : [...currentGroups, savedGroup] });
      setEditingGroup(null);
   }

   function handleSaveSeason(savedSeason: Season) {
      const currentSeasons = config.seasons || [];
      const exists = currentSeasons.some(s => s.id === savedSeason.id);
      onUpdateConfig({ ...config, seasons: exists ? currentSeasons.map(s => s.id === savedSeason.id ? savedSeason : s) : [...currentSeasons, savedSeason] });
      setEditingSeason(null);
   }

   return (
      <div className={`responsive-shell flex min-h-0 flex-col h-full bg-white animate-in fade-in slide-in-from-right-10 duration-300 relative ${isTablet ? 'flex-row' : ''}`}>

         {/* SIDEBAR - Tablet Only */}
         {isTablet && (
            <div className="w-[300px] bg-[#f2f4f7] border-r border-gray-100 flex flex-col p-8 shrink-0 h-full">
               <div className="flex items-center gap-4 mb-16">
                  <div className="p-3 bg-blue-600 rounded-2xl text-white shadow-lg shadow-blue-200">
                     <Package size={24} strokeWidth={2.5} />
                  </div>
                  <div>
                     <h2 className="text-xl font-black text-gray-900 leading-[1.1] tracking-tight">Archivo <br/> de Catálogo</h2>
                  </div>
               </div>

               <nav className="flex-1 space-y-3">
                  <SidebarItem label="Productos" icon={<Package size={22} />} active={viewMode === 'PRODUCTS'} onClick={() => setViewMode('PRODUCTS')} />
                  <SidebarItem label="Monitor BI" icon={<Activity size={22} />} active={viewMode === 'BI_MONITOR'} onClick={() => setViewMode('BI_MONITOR')} />
                  {canManage && <SidebarItem label="Variantes" icon={<Layers size={22} />} active={(viewMode as string) === 'VARIANTS'} onClick={() => setViewMode('VARIANTS')} />}
                  <SidebarItem label="Grupos" icon={<Grid size={22} />} active={viewMode === 'GROUPS'} onClick={() => setViewMode('GROUPS')} />
                  <SidebarItem label="Temporadas" icon={<Sun size={22} />} active={viewMode === 'SEASONS'} onClick={() => setViewMode('SEASONS')} />
                  <SidebarItem label="Stocks" icon={<ClipboardList size={22} />} active={viewMode === 'STOCKS'} onClick={() => setViewMode('STOCKS')} />
                  <SidebarItem label="Tarifas" icon={<Tag size={22} />} active={viewMode === 'TARIFFS'} onClick={() => setViewMode('TARIFFS')} />
               </nav>

               <div className="mt-auto pt-8 border-t border-gray-200">
                  <div className="bg-white rounded-[2rem] p-6 shadow-xl shadow-gray-200/50 border border-gray-100">
                     <div className="flex justify-between items-center mb-3">
                        <span className="text-[11px] font-black text-gray-400 uppercase tracking-widest leading-none">Estado del Sistema</span>
                     </div>
                     <div className="w-full bg-[#f2f4f7] h-2.5 rounded-full overflow-hidden mb-3">
                        <div className="bg-blue-600 h-full w-[85%] rounded-full shadow-[0_0_8px_rgba(37,99,235,0.4)]"></div>
                     </div>
                     <p className="text-[11px] text-gray-400 font-bold">Sincronizado hace 2 min</p>
                  </div>
               </div>

               <button
                  onClick={onClose}
                  className="mt-8 flex items-center justify-center gap-3 w-full py-4 bg-white hover:bg-gray-100 border border-gray-200 rounded-2xl text-gray-700 font-black transition-all active:scale-95 shadow-sm"
               >
                  <ArrowLeft size={20} strokeWidth={3} /> Salir
               </button>
            </div>
         )}

         <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
            {/* TOP BAR / Header */}
            {!isTablet ? (
               <div className="bg-white px-4 pt-4 pb-0 border-b border-gray-200 shrink-0">
                  <div className="flex flex-col gap-4 w-full">
                     <div className="flex justify-between items-center w-full">
                        <div className="flex items-center gap-3">
                           <button onClick={onClose} className="p-2 bg-gray-100 rounded-full text-gray-600"><ArrowLeft size={20} /></button>
                           <h1 className="text-xl font-black text-gray-800">Catálogo</h1>
                        </div>
                        {canManage && (
                           <button onClick={() => setEditingProduct('NEW')} className="p-3 bg-blue-600 text-white rounded-xl shadow-lg"><Plus size={20} /></button>
                        )}
                     </div>
                     <div className="mobile-tab-scroller no-scrollbar -mx-4 px-4 overflow-x-auto whitespace-nowrap">
                           <button onClick={() => setViewMode('PRODUCTS')} className={`inline-flex items-center gap-2 px-4 py-3 text-sm font-bold border-b-4 ${viewMode === 'PRODUCTS' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400'}`}>Productos</button>
                           <button onClick={() => setViewMode('BI_MONITOR')} className={`inline-flex items-center gap-2 px-4 py-3 text-sm font-bold border-b-4 ${viewMode === 'BI_MONITOR' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400'}`}>Monitor</button>
                           <button onClick={() => setViewMode('STOCKS')} className={`inline-flex items-center gap-2 px-4 py-3 text-sm font-bold border-b-4 ${viewMode === 'STOCKS' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400'}`}>Stocks</button>
                     </div>
                  </div>
               </div>
            ) : (
               <div className="bg-white p-8 border-b border-gray-100 flex items-center justify-between gap-8 shrink-0">
                  <div className="flex-1 max-w-2xl relative shadow-2xl shadow-gray-100">
                     <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-400" size={24} />
                     <input
                        type="text"
                        placeholder="Buscar en catálogo..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-16 pr-6 py-5 bg-[#f2f4f7] border-none rounded-3xl outline-none focus:ring-4 focus:ring-blue-500/10 transition-all font-bold text-lg text-gray-700 placeholder:text-gray-300"
                     />
                  </div>
                  {canManage && (
                     <button
                        onClick={() => {
                           if (viewMode === 'PRODUCTS') setEditingProduct('NEW');
                           else if (viewMode === 'TARIFFS') setEditingTariff('NEW');
                           else if (viewMode === 'GROUPS') setEditingGroup('NEW');
                           else if (viewMode === 'SEASONS') setEditingSeason('NEW');
                        }}
                        className="px-8 py-5 bg-blue-600 text-white rounded-[2rem] font-black text-lg shadow-[0_20px_40px_rgba(37,99,235,0.25)] hover:shadow-[0_25px_50px_rgba(37,99,235,0.35)] hover:-translate-y-1 active:translate-y-0.5 active:scale-95 transition-all flex items-center gap-3 group"
                     >
                        <Plus size={28} strokeWidth={4} className="group-hover:rotate-90 transition-transform duration-300" /> Nuevo Artículo
                     </button>
                  )}
               </div>
            )}

            {/* BULK ACTION BAR */}
            {selectedIds.size > 0 && viewMode === 'PRODUCTS' && (
               <div className="fixed inset-x-3 bottom-6 md:inset-x-auto md:bottom-12 md:left-1/2 md:-translate-x-1/2 z-[100] animate-in slide-in-from-bottom-10 fade-in duration-500">
                  <div className="mx-auto w-full bg-gray-900/98 text-white px-10 py-6 rounded-[3rem] shadow-[0_40px_80px_rgba(0,0,0,0.5)] flex items-center gap-10 border border-white/10 backdrop-blur-3xl">
                     <div className="flex items-center gap-5 border-r border-white/10 pr-10">
                        <div className="bg-blue-600 px-5 py-2 rounded-2xl text-lg font-black shadow-lg shadow-blue-500/40">{selectedIds.size}</div>
                        <span className="text-sm font-black uppercase tracking-[0.2em] text-gray-400">Seleccionados</span>
                     </div>
                     <div className="flex gap-6 items-center">
                        {canManage && (
                           <button
                              onClick={() => setShowBulkModal(true)}
                              className="px-8 py-3 bg-blue-600 hover:bg-blue-500 rounded-[1.5rem] font-black text-sm uppercase tracking-widest transition-all flex items-center gap-3 shadow-xl shadow-blue-500/20 active:scale-95"
                           >
                              <Settings2 size={20} /> Editar Propiedades
                           </button>
                        )}
                        <button
                           onClick={() => setSelectedIds(new Set())}
                           className="px-6 py-3 hover:bg-white/10 rounded-[1.5rem] font-black text-sm uppercase tracking-widest text-gray-400 transition-all"
                        >
                           Cancelar
                        </button>
                     </div>
                  </div>
               </div>
            )}

            <div className="flex-1 overflow-y-auto bg-white custom-scrollbar">
               {viewMode === 'PRODUCTS' && (
                  <div className="p-10 md:p-16 max-w-[1600px] mx-auto w-full">
                     {isTablet && (
                        <div className="flex justify-between items-start mb-14">
                           <div>
                              <h1 className="text-6xl font-black text-gray-900 mb-4 leading-none tracking-tight">Gestión de <br/> Productos</h1>
                              <p className="text-xl text-gray-400 font-bold">Explora y organiza tu inventario con precisión.</p>
                           </div>
                           <div className="flex items-center gap-3 bg-[#f2f4f7] p-2 rounded-[2rem] border border-gray-100 shadow-inner">
                              <button className="p-3 bg-white text-gray-900 rounded-[1.25rem] shadow-xl border border-gray-100"><Grid size={28} strokeWidth={2.5} /></button>
                              <button className="p-3 text-gray-400 hover:text-gray-900 transition-all hover:bg-white/50 rounded-[1.25rem]"><MoreHorizontal size={28} strokeWidth={2.5} /></button>
                           </div>
                        </div>
                     )}

                     {/* Categories */}
                     <div className="flex gap-4 overflow-x-auto no-scrollbar mb-14 pb-2">
                        {categories.map(c => (
                           <button
                              key={c}
                              onClick={() => setCategoryFilter(c)}
                              className={`px-8 py-3.5 rounded-full text-lg font-black transition-all whitespace-nowrap ${categoryFilter === c ? 'bg-blue-600 text-white shadow-[0_15px_30px_rgba(37,99,235,0.25)] scale-105' : 'bg-white text-gray-400 border-2 border-gray-50 hover:border-gray-100 hover:bg-gray-50'}`}
                           >
                              {c === 'ALL' ? 'Todos' : c}
                           </button>
                        ))}
                     </div>

                     <div
                        className="grid gap-10 pb-60"
                        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${isTablet ? '300px' : '180px'}, 1fr))` }}
                     >
                        {filteredProducts.map(product => {
                           const isSelected = selectedIds.has(product.id);
                           return (
                              <div
                                 key={product.id}
                                 onClick={() => {
                                    if (selectedIds.size > 0) toggleSelection(product.id);
                                    else if (isTablet) setEditingProduct(product);
                                 }}
                                 className={`bg-white rounded-[3rem] p-6 shadow-sm border-2 transition-all group flex flex-col relative h-full ${isSelected ? 'border-blue-600 bg-blue-50/10 ring-[12px] ring-blue-50' : 'border-transparent hover:shadow-[0_40px_80px_rgba(0,0,0,0.06)] hover:-translate-y-2'}`}
                              >
                                 {/* Selection Marker */}
                                 {(isSelected || selectedIds.size > 0) && (
                                    <button
                                       onClick={(e) => { e.stopPropagation(); toggleSelection(product.id); }}
                                       className={`absolute top-6 left-6 z-10 p-3 rounded-2xl transition-all ${isSelected ? 'bg-blue-600 text-white scale-110 shadow-xl' : 'bg-white/95 text-gray-200 border-2 border-gray-50'}`}
                                    >
                                       {isSelected ? <CheckSquare size={22} strokeWidth={3} /> : <Square size={22} strokeWidth={2.5} />}
                                    </button>
                                 )}

                                 <div className="aspect-square bg-[#f8f9fa] rounded-[2.5rem] mb-8 relative overflow-hidden flex items-center justify-center p-10 group-hover:bg-[#f1f3f5] transition-colors">
                                    {product.image ? (
                                       <img src={product.image} alt={product.name} className="w-full h-full object-contain transition-transform duration-500 group-hover:scale-110" />
                                    ) : (
                                       <ImageIcon className="text-gray-200" size={80} strokeWidth={1.5} />
                                    )}

                                    {/* Action Overlays for Tablet */}
                                    {isTablet && !isSelected && selectedIds.size === 0 && (
                                       <div className="absolute top-6 right-6 opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0">
                                          <button
                                             onClick={(e) => { e.stopPropagation(); setEditingProduct(product); }}
                                             className="p-4 bg-white text-gray-900 rounded-2xl shadow-2xl hover:text-blue-600 hover:scale-110 active:scale-95 flex items-center justify-center border border-gray-50"
                                          >
                                             <Edit2 size={24} strokeWidth={2.5} />
                                          </button>
                                       </div>
                                    )}
                                 </div>

                                 <div className="flex-1 flex flex-col px-2">
                                    <div className="flex items-center justify-between mb-4">
                                       <span className="text-[11px] font-black uppercase tracking-[0.15em] text-gray-400 bg-gray-100 px-4 py-1.5 rounded-full leading-none">
                                          {product.category}
                                       </span>
                                       <div className={`w-4 h-4 rounded-full shadow-sm ${(product.stockBalances?.[warehouses[0]?.id] || 0) > 0 ? 'bg-emerald-500 shadow-emerald-200' : 'bg-red-500 shadow-red-200'}`}></div>
                                    </div>

                                    <h3 className="font-black text-gray-900 leading-[1.25] mb-2 text-2xl line-clamp-2 min-h-[4rem] group-hover:text-blue-600 transition-colors">
                                       {product.name}
                                    </h3>
                                    <p className="text-sm text-gray-300 font-bold mb-6 font-mono tracking-wider">SKU: {product.barcode || '---'}</p>

                                    <div className="mt-auto flex justify-between items-center py-4 border-t border-gray-50">
                                       <span className="text-3xl font-black text-blue-600 tracking-tight">
                                          {config.currencySymbol}{ (product.price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 }) }
                                       </span>
                                    </div>
                                 </div>
                              </div>
                           )
                        })}
                     </div>
                  </div>
               )}

               {viewMode === 'BI_MONITOR' && (
                  <WatchlistMonitor
                     products={products}
                     transactions={transactions}
                     watchlists={watchlists}
                     config={config}
                     warehouses={warehouses}
                     onUpdateWatchlists={handleUpdateWatchlists}
                     onOpenKardex={(p) => setEditingProduct(p)}
                     onOpenPromo={(p) => alert(`Abriendo diseñador de ofertas para: ${p.name}`)}
                  />
               )}

               {viewMode === 'STOCKS' && (
                  <div className="p-16 max-w-[1400px] mx-auto w-full flex-1 flex flex-col overflow-hidden">
                     <div className="mb-14 flex justify-between items-end">
                        <div>
                           <h2 className="text-5xl font-black text-gray-900 mb-4 tracking-tight">Inventario Físico</h2>
                           <p className="text-xl text-gray-400 font-bold">Existencias físicas y valorización global por almacén.</p>
                        </div>
                        <span className="text-sm bg-emerald-50 text-emerald-700 px-6 py-3 rounded-full font-black border-2 border-emerald-100 flex items-center gap-3 shadow-lg shadow-emerald-100/50">
                           <CheckCircle2 size={20} strokeWidth={3} /> EN TIEMPO REAL
                        </span>
                     </div>
                     <div className="flex-1 space-y-12 pb-40 custom-scrollbar overflow-y-auto pr-4">
                        {warehouses.map(warehouse => <WarehouseStockCard key={warehouse.id} warehouse={warehouse} filteredProducts={filteredProducts} productStocks={productStocks} />)}
                     </div>
                  </div>
               )}

               {viewMode === 'TARIFFS' && (
                  <div className="p-16 max-w-[1600px] mx-auto w-full flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-10 pb-40">
                     {tariffs.map(tariff => (
                        <div key={tariff.id} className="bg-white rounded-[3rem] p-10 shadow-sm border-2 border-transparent hover:border-blue-500/20 hover:shadow-2xl hover:shadow-blue-500/5 transition-all relative overflow-hidden group">
                           <div className="flex justify-between items-start mb-10">
                              <div className={`p-6 rounded-[2.5rem] ${tariff.active ? 'bg-blue-50 text-blue-600' : 'bg-gray-50 text-gray-300'} transition-colors group-hover:scale-110 duration-500`}>
                                 <Tag size={40} strokeWidth={2.5} />
                              </div>
                              <div className="flex gap-3">
                                 <button onClick={() => setEditingTariff(tariff)} className="p-4 bg-[#f2f4f7] text-gray-400 hover:text-blue-600 hover:bg-white hover:shadow-xl rounded-[1.5rem] transition-all"><Edit2 size={24} strokeWidth={2.5} /></button>
                              </div>
                           </div>
                           <h3 className="text-3xl font-black text-gray-900 mb-4 tracking-tight">{tariff.name}</h3>
                           <div className="flex items-center gap-4 mb-10">
                              <span className={`px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-widest ${tariff.active ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-200' : 'bg-gray-200 text-gray-400'}`}>
                                 {tariff.active ? 'Activa' : 'Inactive'}
                              </span>
                              <span className="text-sm text-gray-300 font-bold font-mono">{tariff.strategy.type}</span>
                           </div>
                           <div className="space-y-6 pt-10 border-t border-gray-50">
                              <div className="flex items-center gap-4 text-lg text-gray-400 font-bold">
                                 <Calendar size={24} className="text-blue-200" />
                                 <span>{tariff.schedule.daysOfWeek.length === 7 ? 'Semana completa' : `${tariff.schedule.daysOfWeek.length} días activos`}</span>
                              </div>
                              <div className="flex items-center gap-4 text-lg text-gray-400 font-bold">
                                 <DollarSign size={24} className="text-blue-200" />
                                 <span>{tariff.currency}</span>
                              </div>
                           </div>
                        </div>
                     ))}
                     <button onClick={() => setEditingTariff('NEW')} className="bg-gray-50 rounded-[3rem] p-10 border-4 border-dashed border-gray-100 hover:border-blue-200 hover:bg-white transition-all flex flex-col items-center justify-center text-gray-300 hover:text-blue-600 gap-8 group">
                        <div className="p-8 bg-white rounded-full shadow-2xl text-blue-600 group-hover:scale-110 transition-transform duration-500"><Plus size={60} strokeWidth={4} /></div>
                        <span className="text-2xl font-black">Nueva Lista</span>
                     </button>
                  </div>
               )}
            </div>
         </div>

         {/* Floating Action Button for Mobile */}
         {!isTablet && canManage && viewMode === 'PRODUCTS' && (
            <button
               onClick={() => setEditingProduct('NEW')}
               className="fixed bottom-8 right-8 w-20 h-20 bg-blue-600 text-white rounded-[2rem] shadow-[0_25px_50px_rgba(37,99,235,0.4)] flex items-center justify-center z-50 active:scale-90 transition-all"
            >
               <Plus size={40} strokeWidth={4} />
            </button>
         )}

         {showBulkModal && (
            <BulkEditModal
               config={config}
               warehouses={warehouses}
               products={products}
               seasons={config.seasons || []}
               groups={config.productGroups || []}
               selectedCount={selectedIds.size}
               onClose={() => setShowBulkModal(false)}
               onSave={handleBulkUpdate}
            />
         )}
      </div>
   );
};

interface SidebarItemProps {
   label: string;
   icon: React.ReactNode;
   active: boolean;
   onClick: () => void;
}

const SidebarItem: React.FC<SidebarItemProps> = ({ label, icon, active, onClick }) => (
   <button
      onClick={onClick}
      className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all font-bold ${active ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:bg-white/50 hover:text-gray-800'}`}
   >
      <span className={active ? 'text-blue-600' : 'text-gray-400'}>{icon}</span>
      <span className="text-[15px]">{label}</span>
      {active && <div className="ml-auto w-1.5 h-6 bg-blue-600 rounded-full"></div>}
   </button>
);

export default CatalogManager;
