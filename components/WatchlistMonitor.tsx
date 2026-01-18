
import React, { useState, useMemo } from 'react';
import { 
  LayoutGrid, Activity, Calendar, TrendingUp, AlertTriangle, 
  MoreVertical, ArrowRightLeft, Tag, BookOpen, Clock, 
  Filter, Plus, Trash2, Box, ChevronRight, PieChart,
  ShoppingBag, HelpCircle, ShieldAlert, PackagePlus
} from 'lucide-react';
import { Product, Transaction, Watchlist, WatchlistKPIs, BusinessConfig, Warehouse, WatchlistAlertSettings, ProductGroup } from '../types';
import WatchlistAlertModal from './WatchlistAlertModal';
import WatchlistAddProductsModal from './WatchlistAddProductsModal';

interface WatchlistMonitorProps {
  products: Product[];
  transactions: Transaction[];
  watchlists: Watchlist[];
  config: BusinessConfig;
  warehouses: Warehouse[];
  onUpdateWatchlists: (watchlists: Watchlist[]) => void;
  onOpenKardex: (product: Product) => void;
  onOpenPromo: (product: Product) => void;
}

const WatchlistMonitor: React.FC<WatchlistMonitorProps> = ({ 
  products, transactions, watchlists, config, warehouses, 
  onUpdateWatchlists, onOpenKardex, onOpenPromo 
}) => {
  const [selectedListId, setSelectedListId] = useState<string>(watchlists[0]?.id || '');
  const [storeFilter, setStoreFilter] = useState<string>('ALL');
  const [isAddingList, setIsAddingList] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showAddProductsModal, setShowAddProductsModal] = useState(false);

  const selectedList = watchlists.find(w => w.id === selectedListId);

  // --- BI CALCULATION ENGINE ---
  const kpiData = useMemo(() => {
    if (!selectedList) return [];

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    return selectedList.productIds.map(pid => {
      const product = products.find(p => p.id === pid);
      if (!product) return null;

      // Filter transactions for this specific product
      const productTxns = transactions.filter(t => t.items.some(i => i.id === pid));
      
      // Calculate Last Sale
      const sortedTxns = [...productTxns].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      const lastSale = sortedTxns[0] ? sortedTxns[0].date : null;
      const daysSinceLastSale = lastSale ? Math.floor((now.getTime() - new Date(lastSale).getTime()) / (24 * 60 * 60 * 1000)) : 999;

      // Calculate Velocity (Last 7 Days)
      // Fix: declared recentTxns with const and removed unused unitsSoldWeek to resolve "Cannot find name" error
      const recentTxns = productTxns.filter(t => new Date(t.date) >= weekAgo);
      const unitsSoldWeekCount = recentTxns.reduce((sum, t) => {
        const item = t.items.find(i => i.id === pid);
        return sum + (item?.quantity || 0);
      }, 0);
      const velocity7d = unitsSoldWeekCount / 7;

      // Calculate Sell-Through
      const totalSoldAllTime = productTxns.reduce((sum, t) => {
        const item = t.items.find(i => i.id === pid);
        return sum + (item?.quantity || 0);
      }, 0);
      const currentStock = storeFilter === 'ALL' 
        ? Object.values(product.stockBalances || {}).reduce((a: number, b: number) => a + b, 0)
        : product.stockBalances?.[storeFilter] || 0;
      
      const sellThrough = totalSoldAllTime > 0 ? (totalSoldAllTime / (totalSoldAllTime + currentStock)) * 100 : 0;

      // Calculate Weeks of Supply
      const weeksOfSupply = velocity7d > 0 ? (currentStock / (velocity7d * 7)) : (currentStock > 0 ? 52 : 0);

      return {
        productId: pid,
        lastSaleDate: lastSale,
        daysSinceLastSale,
        velocity7d,
        sellThrough,
        weeksOfSupply,
        totalSoldPeriod: unitsSoldWeekCount,
        currentStock
      };
    }).filter(Boolean) as (WatchlistKPIs & { currentStock: number })[];
  }, [selectedList, products, transactions, storeFilter]);

  // --- HANDLERS ---
  const handleCreateList = () => {
    if (!newListName.trim()) return;
    const newList: Watchlist = {
      id: `wl-${Date.now()}`,
      name: newListName,
      criteria: 'MANUAL',
      productIds: [],
      createdAt: new Date().toISOString(),
      color: 'bg-slate-500',
      alertSettings: {
        maxDormancyDays: 30,
        minVelocity: 0.5,
        minSellThrough: 15,
        criticalWeeksOfSupply: 1,
        overstockWeeksOfSupply: 12
      }
    };
    onUpdateWatchlists([...watchlists, newList]);
    setSelectedListId(newList.id);
    setNewListName('');
    setIsAddingList(false);
  };

  const handleSaveAlerts = (newSettings: WatchlistAlertSettings, updatedProductIds?: string[]) => {
    if (!selectedList) return;
    const updated = watchlists.map(w => w.id === selectedList.id ? { 
      ...w, 
      alertSettings: newSettings,
      productIds: updatedProductIds || w.productIds
    } : w);
    onUpdateWatchlists(updated);
    setShowConfigModal(false);
  };

  const handleAddItems = (ids: string[]) => {
    if (!selectedList) return;
    const currentIds = new Set(selectedList.productIds);
    ids.forEach(id => currentIds.add(id));
    
    const updated = watchlists.map(w => w.id === selectedList.id ? { ...w, productIds: Array.from(currentIds) } : w);
    onUpdateWatchlists(updated);
    setShowAddProductsModal(false);
  };

  const handleDeleteList = (id: string) => {
    if (confirm("¿Eliminar este tablero de seguimiento?")) {
      const filtered = watchlists.filter(w => w.id !== id);
      onUpdateWatchlists(filtered);
      if (selectedListId === id) setSelectedListId(filtered[0]?.id || '');
    }
  };

  const getDormancyStyles = (days: number) => {
    const limit = selectedList?.alertSettings.maxDormancyDays || 30;
    if (days >= limit) return 'text-red-600 bg-red-50 border-red-200 ring-2 ring-red-100';
    if (days >= limit * 0.7) return 'text-orange-600 bg-orange-50 border-orange-200';
    return 'text-emerald-600 bg-emerald-50 border-emerald-200';
  };

  const getStockCoverageStyles = (weeks: number) => {
    const min = selectedList?.alertSettings.criticalWeeksOfSupply || 1;
    const max = selectedList?.alertSettings.overstockWeeksOfSupply || 12;
    if (weeks <= min) return 'text-red-600 font-black flex items-center gap-1';
    if (weeks >= max) return 'text-indigo-600 font-black flex items-center gap-1';
    return 'text-slate-600';
  };

  return (
    <div className="flex h-full bg-slate-50 animate-in fade-in slide-in-from-right-10 duration-300">
      
      {/* SIDEBAR: WATCHLISTS SELECTOR */}
      <aside className="w-72 bg-white border-r border-slate-200 flex flex-col shrink-0 shadow-sm z-10">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/30">
          <div>
            <h2 className="text-xl font-black text-slate-800">Monitores</h2>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Inteligencia Retail</p>
          </div>
          <button 
            onClick={() => setIsAddingList(true)}
            className="p-2 bg-blue-600 text-white rounded-xl shadow-lg hover:bg-blue-700 transition-all active:scale-95"
          >
            <Plus size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {isAddingList && (
            <div className="p-3 bg-blue-50 rounded-2xl border-2 border-blue-200 mb-4 animate-in zoom-in-95">
              <input 
                autoFocus
                type="text" 
                value={newListName}
                onChange={e => setNewListName(e.target.value)}
                placeholder="Nombre de la lista..."
                className="w-full p-2 bg-white rounded-xl border border-blue-200 text-sm font-bold outline-none mb-2"
              />
              <div className="flex gap-2">
                <button onClick={handleCreateList} className="flex-1 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold">Crear</button>
                <button onClick={() => setIsAddingList(false)} className="flex-1 py-1.5 bg-slate-200 text-slate-600 rounded-lg text-xs font-bold">Cancelar</button>
              </div>
            </div>
          )}

          {watchlists.map(wl => (
            <div 
              key={wl.id}
              onClick={() => setSelectedListId(wl.id)}
              className={`group p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-center justify-between ${
                selectedListId === wl.id 
                  ? 'bg-white border-blue-500 shadow-md ring-4 ring-blue-50' 
                  : 'bg-white border-transparent hover:border-slate-200'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${wl.color || 'bg-slate-400'} ${selectedListId === wl.id ? 'animate-pulse' : ''}`} />
                <div>
                  <h4 className={`font-bold text-sm ${selectedListId === wl.id ? 'text-blue-900' : 'text-slate-600'}`}>{wl.name}</h4>
                  <p className="text-[10px] text-slate-400 font-bold uppercase">{wl.productIds.length} artículos</p>
                </div>
              </div>
              <button 
                onClick={(e) => { e.stopPropagation(); handleDeleteList(wl.id); }}
                className="opacity-0 group-hover:opacity-100 p-1 text-slate-300 hover:text-red-500 transition-all"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="p-4 bg-slate-50 border-t border-slate-100">
           <div className="flex items-center gap-2 text-slate-400 text-[10px] font-bold uppercase tracking-tighter">
              <HelpCircle size={12} />
              <span>Ayuda: BI Analytics v1.2</span>
           </div>
        </div>
      </aside>

      {/* MAIN PANEL */}
      <main className="flex-1 flex flex-col min-w-0">
        
        {/* Header con Filtros */}
        <header className="bg-white px-8 py-5 border-b border-slate-200 flex justify-between items-center shrink-0">
          <div>
            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-3">
              <Activity className="text-blue-600" /> {selectedList?.name || 'Monitor de Seguimiento'}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-slate-400 font-medium">Filtro Contextual:</span>
              <select 
                value={storeFilter}
                onChange={e => setStoreFilter(e.target.value)}
                className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-lg border-none outline-none cursor-pointer"
              >
                <option value="ALL">Todas las Sucursales</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
          </div>

          <div className="flex gap-3">
             {selectedList && (
               <button 
                  onClick={() => setShowAddProductsModal(true)}
                  className="flex items-center gap-2 px-5 py-3 bg-blue-600 text-white rounded-2xl font-bold text-sm shadow-xl hover:bg-blue-700 transition-all active:scale-95"
               >
                  <PackagePlus size={18} /> Añadir Artículos
               </button>
             )}
             <div className="text-right px-6 border-x border-slate-100 hidden md:block">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Valor Monitoreado</p>
                <p className="text-xl font-black text-slate-800">
                  {config.currencySymbol}{kpiData.reduce((acc: number, curr) => {
                    const p = products.find(x => x.id === curr.productId);
                    return acc + (curr.currentStock * (p?.cost || 0));
                  }, 0).toLocaleString()}
                </p>
             </div>
             <button 
                onClick={() => setShowConfigModal(true)}
                className="flex items-center gap-2 px-5 py-3 bg-slate-900 text-white rounded-2xl font-bold text-sm shadow-xl hover:bg-black transition-all active:scale-95"
             >
                <Filter size={18} /> Ajustes & Alertas
             </button>
          </div>
        </header>

        {/* Grilla BI */}
        <div className="flex-1 overflow-hidden p-8">
          <div className="bg-white rounded-[2.5rem] shadow-xl border border-slate-200 flex flex-col h-full overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50/50 border-b border-slate-100 text-slate-400 font-bold uppercase text-[10px] tracking-widest sticky top-0 z-20">
                  <tr>
                    <th className="p-6">Producto</th>
                    <th className="p-6 text-center">Stock Actual</th>
                    <th className="p-6 text-center">Días Sin Venta</th>
                    <th className="p-6 text-center">Velocidad (7d)</th>
                    <th className="p-6 text-center">Sell-Through %</th>
                    <th className="p-6 text-center">Cobertura (WOS)</th>
                    <th className="p-6">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {kpiData.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-20 text-center">
                        <div className="flex flex-col items-center opacity-30">
                          <ShoppingBag size={64} className="mb-4" />
                          <p className="text-lg font-bold text-slate-800">Esta lista está vacía</p>
                          <p className="text-sm">Agrega artículos o grupos desde el catálogo para monitorearlos.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    kpiData.map(kpi => {
                      const product = products.find(p => p.id === kpi.productId);
                      if (!product) return null;

                      const isVelocityCrit = kpi.velocity7d < (selectedList?.alertSettings.minVelocity || 0);
                      const isSellThroughCrit = kpi.sellThrough < (selectedList?.alertSettings.minSellThrough || 0);

                      return (
                        <tr key={kpi.productId} className="hover:bg-blue-50/30 transition-colors group">
                          <td className="p-5">
                            <div className="flex items-center gap-4">
                              <div className="w-12 h-12 bg-slate-100 rounded-xl overflow-hidden border border-slate-200 shrink-0">
                                {product.image ? (
                                  <img src={product.image} className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-slate-300"><Box size={20} /></div>
                                )}
                              </div>
                              <div>
                                <p className="font-bold text-slate-800 leading-tight">{product.name}</p>
                                <p className="text-[10px] text-slate-400 font-mono mt-0.5">{product.barcode || 'SIN-EAN'}</p>
                              </div>
                            </div>
                          </td>
                          <td className="p-5 text-center">
                            <span className={`px-3 py-1 rounded-lg font-black text-sm ${kpi.currentStock < (product.minStock || 5) ? 'bg-red-50 text-red-600 animate-pulse' : 'bg-slate-100 text-slate-700'}`}>
                              {kpi.currentStock}
                            </span>
                          </td>
                          <td className="p-5 text-center">
                            <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-black transition-transform group-hover:scale-105 ${getDormancyStyles(kpi.daysSinceLastSale)}`}>
                              <Clock size={12} />
                              {kpi.daysSinceLastSale === 999 ? '∞' : `${kpi.daysSinceLastSale}d`}
                            </div>
                          </td>
                          <td className="p-5 text-center">
                            <p className={`font-bold ${isVelocityCrit ? 'text-red-500' : 'text-slate-700'}`}>{kpi.velocity7d.toFixed(2)}</p>
                            <p className="text-[9px] text-slate-400 uppercase font-black">u/día</p>
                          </td>
                          <td className="p-5 text-center">
                            <div className="w-24 mx-auto bg-slate-100 h-2 rounded-full overflow-hidden mb-1">
                              <div className={`h-full rounded-full ${isSellThroughCrit ? 'bg-orange-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(kpi.sellThrough, 100)}%` }} />
                            </div>
                            <span className={`text-[10px] font-black ${isSellThroughCrit ? 'text-orange-600' : 'text-emerald-600'}`}>{kpi.sellThrough.toFixed(1)}%</span>
                          </td>
                          <td className="p-5 text-center">
                            <p className={`text-lg font-black ${getStockCoverageStyles(kpi.weeksOfSupply)}`}>
                              {kpi.weeksOfSupply >= 52 ? '>1a' : kpi.weeksOfSupply.toFixed(1)}
                              {kpi.weeksOfSupply <= (selectedList?.alertSettings.criticalWeeksOfSupply || 1) && <ShieldAlert size={14} className="text-red-500" />}
                              {kpi.weeksOfSupply >= (selectedList?.alertSettings.overstockWeeksOfSupply || 12) && <AlertTriangle size={14} className="text-indigo-500" />}
                            </p>
                            <p className="text-[9px] text-slate-400 uppercase font-bold">semanas</p>
                          </td>
                          <td className="p-5">
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button 
                                onClick={() => onOpenKardex(product)}
                                className="p-2 hover:bg-white hover:text-blue-600 rounded-lg border border-transparent hover:border-slate-200 transition-all"
                                title="Ver Movimientos"
                              >
                                <BookOpen size={16} />
                              </button>
                              <button 
                                onClick={() => onOpenPromo(product)}
                                className="p-2 hover:bg-white hover:text-purple-600 rounded-lg border border-transparent hover:border-slate-200 transition-all"
                                title="Crear Oferta"
                              >
                                <Tag size={16} />
                              </button>
                              <button 
                                className="p-2 hover:bg-white hover:text-slate-900 rounded-lg border border-transparent hover:border-slate-200 transition-all"
                                title="Traspaso Sugerido"
                              >
                                <ArrowRightLeft size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>

      {/* MODAL DE CONFIGURACIÓN DE ALERTAS */}
      {showConfigModal && selectedList && (
         <WatchlistAlertModal 
            watchlist={selectedList}
            products={products}
            onClose={() => setShowConfigModal(false)}
            onSave={handleSaveAlerts}
         />
      )}

      {/* MODAL DE AÑADIR ARTÍCULOS */}
      {showAddProductsModal && selectedList && (
         <WatchlistAddProductsModal 
            products={products}
            config={config}
            selectedProductIds={selectedList.productIds}
            onClose={() => setShowAddProductsModal(false)}
            onConfirm={handleAddItems}
         />
      )}

    </div>
  );
};

export default WatchlistMonitor;
