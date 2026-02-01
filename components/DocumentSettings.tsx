
import React, { useState, useMemo, useEffect } from 'react';
import { BusinessConfig, DocumentSeries, FiscalRangeDGII, Transaction } from '../types';
import {
   FileText, Receipt, RotateCcw, FileSpreadsheet,
   Edit2, Check, X, AlertTriangle, ShieldAlert,
   ArrowRight, ArrowRightLeft, ArrowUpRight, Hash, Type, Landmark, Calendar,
   ShieldCheck, AlertOctagon, Plus, Trash2, ChevronRight,
   Save, AlignLeft, BarChart3, Activity, PieChart, ShoppingBag, Box
} from 'lucide-react';
import { db } from '../utils/db';
import { NCFType } from '../types';
import { seriesSyncService } from '../services/sync/SeriesSyncService';
import { syncManager } from '../services/sync/SyncManager';

interface DocumentSettingsProps {
   onClose: () => void;
}

const DocumentSettings: React.FC<DocumentSettingsProps> = ({ onClose }) => {
   const [activeSubTab, setActiveSubTab] = useState<'SERIES' | 'FISCAL_POOL'>('SERIES');

   // Data for Series
   const [seriesList, setSeriesList] = useState<DocumentSeries[]>([]);

   const [editingSeries, setEditingSeries] = useState<DocumentSeries | null>(null);

   // Data for Fiscal Pool & Transactions for Audit
   const [fiscalRanges, setFiscalRanges] = useState<FiscalRangeDGII[]>([]);

   const [transactions, setTransactions] = useState<Transaction[]>([]);

   useEffect(() => {
      const loadData = async () => {
         console.log('📖 DocumentSettings: Loading series data...');
         const seqs = (await db.get('internalSequences') || []) as DocumentSeries[];
         console.log(`📖 DocumentSettings: Loaded ${seqs.length} series from DB:`, seqs);
         setSeriesList(seqs);

         setFiscalRanges((await db.get('fiscalRanges') || []) as FiscalRangeDGII[]);
         setTransactions((await db.get('transactions') as Transaction[]) || []);
      };
      loadData();

      // Listen for series updates from other terminals
      const handleSeriesUpdate = () => {
         console.log('🔔 DocumentSettings: Received series update event, reloading...');
         loadData();
         console.log('📥 Series list refreshed from sync');
      };

      window.addEventListener('seriesUpdated', handleSeriesUpdate);
      window.addEventListener('internalSequencesUpdated', handleSeriesUpdate);

      return () => {
         window.removeEventListener('seriesUpdated', handleSeriesUpdate);
         window.removeEventListener('internalSequencesUpdated', handleSeriesUpdate);
      };
   }, []);

   const [isAddingRange, setIsAddingRange] = useState(false);
   const [newRange, setNewRange] = useState<Partial<FiscalRangeDGII>>({ type: 'B01', prefix: 'B01', startNumber: 1, endNumber: 1000, expiryDate: '2026-12-31' });

   // --- FISCAL AUDIT LOGIC ---
   const fiscalConsumption = useMemo(() => {
      const stats: Record<NCFType, number> = { 'B01': 0, 'B02': 0, 'B14': 0, 'B15': 0 };

      if (Array.isArray(transactions)) {
         transactions.forEach(tx => {
            if (tx && tx.ncfType && stats[tx.ncfType] !== undefined) {
               stats[tx.ncfType] = (stats[tx.ncfType] || 0) + 1;
            }
         });
      }

      return stats;
   }, [transactions]);

   const handleAddNewSeries = () => {
      setEditingSeries({
         id: `DOC_${Date.now()}`,
         documentType: 'TICKET',
         name: '',
         description: 'Documento interno personalizado.',
         prefix: 'DOC',
         nextNumber: 1,
         padding: 6,
         icon: 'FileText',
         color: 'blue'
      });
   };

   const handleSaveInternalSeries = async () => {
      if (!editingSeries) return;

      let updated;
      const exists = seriesList.some(s => s.id === editingSeries.id);

      if (exists) {
         updated = seriesList.map(s => s.id === editingSeries.id ? editingSeries : s);
      } else {
         updated = [...seriesList, editingSeries];
      }

      setSeriesList(updated);
      await db.save('internalSequences', updated);

      // Broadcast change to other terminals via SeriesSyncService (Instant)
      await seriesSyncService.broadcastChange(
         exists ? 'UPDATE' : 'CREATE',
         editingSeries
      );

      // Push to SyncManager (Persistent/Manual Sync)
      await syncManager.pushCatalog('internalSequences');

      setEditingSeries(null);
   };

   const handleDeleteSeries = async (id: string) => {
      if (!confirm("¿Desea eliminar este tipo de documento? Las transacciones existentes no se verán afectadas pero no podrá emitir nuevos bajo esta serie.")) return;

      const updated = seriesList.filter(s => s.id !== id);
      setSeriesList(updated);
      await db.save('internalSequences', updated);

      // Broadcast deletion to other terminals
      await seriesSyncService.broadcastChange('DELETE', id);

      // Push to SyncManager (Persistent/Manual Sync)
      await syncManager.pushCatalog('internalSequences');
   };

   const handleSaveRange = async () => {
      if (!newRange.prefix || !newRange.startNumber || !newRange.endNumber) return;
      const range: FiscalRangeDGII = {
         ...newRange as FiscalRangeDGII,
         id: `fr-${Date.now()}`,
         currentGlobal: (newRange.startNumber || 1) - 1,
         isActive: true
      };
      const updated = [...fiscalRanges, range];
      setFiscalRanges(updated);
      await db.save('fiscalRanges', updated);
      setIsAddingRange(false);
   };

   const handleToggleRange = async (id: string) => {
      const updated = fiscalRanges.map(r => r.id === id ? { ...r, isActive: !r.isActive } : r);
      setFiscalRanges(updated);
      await db.save('fiscalRanges', updated);
   };

   return (
      <div className="flex flex-col h-full bg-gray-50 animate-in fade-in slide-in-from-right-10 duration-300">

         {/* Header */}
         <div className="bg-white px-8 py-6 border-b border-gray-200 flex justify-between items-center shrink-0">
            <div>
               <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
                  <FileText className="text-slate-900" /> Document Center
               </h1>
               <p className="text-sm text-gray-500">Gestión de series y cumplimiento fiscal DGII.</p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"><X size={24} /></button>
         </div>

         <div className="px-8 bg-white border-b border-gray-200 flex gap-8 shrink-0">
            <button onClick={() => setActiveSubTab('SERIES')} className={`py-4 text-sm font-bold border-b-4 transition-all ${activeSubTab === 'SERIES' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>Secuencias Internas</button>
            <button onClick={() => setActiveSubTab('FISCAL_POOL')} className={`py-4 text-sm font-bold border-b-4 transition-all flex items-center gap-2 ${activeSubTab === 'FISCAL_POOL' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
               <Landmark size={16} /> Pool Fiscal DGII
            </button>
         </div>

         <div className="flex-1 overflow-hidden p-8">
            <div className="max-w-6xl mx-auto h-full overflow-y-auto custom-scrollbar">

               {activeSubTab === 'SERIES' && (
                  <div className="space-y-6 animate-in slide-in-from-bottom-4">
                     <div className="flex justify-between items-center px-2">
                        <h2 className="text-lg font-bold text-gray-800 uppercase tracking-widest text-xs opacity-50">Secuencias por Tipo</h2>
                        <button
                           onClick={handleAddNewSeries}
                           className="px-6 py-2.5 bg-blue-600 text-white rounded-xl font-bold shadow-lg hover:bg-blue-700 flex items-center gap-2 active:scale-95 transition-all"
                        >
                           <Plus size={20} /> Nueva Serie
                        </button>
                     </div>


                     {/* Group by Document Type */}
                     {([
                        'TICKET', 'REFUND', 'VOID',
                        'TRANSFER', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'PURCHASE', 'PRODUCTION',
                        'CASH_IN', 'CASH_OUT', 'CASH_DEPOSIT', 'CASH_WITHDRAWAL',
                        'Z_REPORT', 'X_REPORT',
                        'RECEIVABLE', 'PAYABLE', 'PAYMENT_IN', 'PAYMENT_OUT'
                     ] as const).map(docType => {
                        const typeSeries = seriesList.filter(s => s.documentType === docType);

                        // Skip if no series for this type
                        if (typeSeries.length === 0) return null;

                        const typeConfig: Record<string, { label: string; icon: any; color: string }> = {
                           // Ventas
                           TICKET: { label: 'Tickets de Venta', icon: Receipt, color: 'blue' },
                           REFUND: { label: 'Devoluciones / Abonos', icon: RotateCcw, color: 'orange' },
                           VOID: { label: 'Anulaciones', icon: X, color: 'red' },

                           // Inventario
                           TRANSFER: { label: 'Traspasos', icon: ArrowRightLeft, color: 'purple' },
                           ADJUSTMENT_IN: { label: 'Ajustes Positivos', icon: Plus, color: 'green' },
                           ADJUSTMENT_OUT: { label: 'Ajustes Negativos', icon: Trash2, color: 'red' },
                           PURCHASE: { label: 'Compras', icon: ShoppingBag, color: 'indigo' },
                           PRODUCTION: { label: 'Producción', icon: Box, color: 'cyan' },

                           // Efectivo
                           CASH_IN: { label: 'Entradas de Efectivo', icon: ArrowRight, color: 'emerald' },
                           CASH_OUT: { label: 'Salidas de Efectivo', icon: ArrowRight, color: 'rose' },
                           CASH_DEPOSIT: { label: 'Depósitos Bancarios', icon: Landmark, color: 'teal' },
                           CASH_WITHDRAWAL: { label: 'Retiros', icon: Landmark, color: 'amber' },

                           // Cierres
                           Z_REPORT: { label: 'Cierres de Caja (Z)', icon: Save, color: 'slate' },
                           X_REPORT: { label: 'Cortes Parciales (X)', icon: FileText, color: 'gray' },

                           // Cuentas
                           RECEIVABLE: { label: 'Cuentas por Cobrar', icon: ArrowUpRight, color: 'sky' },
                           PAYABLE: { label: 'Cuentas por Pagar', icon: ArrowUpRight, color: 'violet' },
                           PAYMENT_IN: { label: 'Cobros Recibidos', icon: Check, color: 'lime' },
                           PAYMENT_OUT: { label: 'Pagos Realizados', icon: Check, color: 'fuchsia' }
                        };

                        const config = typeConfig[docType];
                        if (!config) return null;

                        const Icon = config.icon;


                        return (
                           <div key={docType} className="space-y-4">
                              <div className="flex items-center gap-3 px-2">
                                 <div className={`p-2 rounded-lg bg-${config.color}-50 text-${config.color}-600`}>
                                    <Icon size={20} />
                                 </div>
                                 <h3 className="font-bold text-gray-700">{config.label}</h3>
                                 <span className="text-xs text-gray-400">({typeSeries.length} serie{typeSeries.length !== 1 ? 's' : ''})</span>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                 {typeSeries.map((series) => (
                                    <div key={series.id} className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-all flex justify-between items-center group">
                                       <div className="flex items-center gap-3">
                                          <div className={`w-10 h-10 bg-${config.color}-50 text-${config.color}-600 rounded-lg flex items-center justify-center font-bold text-xs`}>{series.prefix}</div>
                                          <div>
                                             <h4 className="font-bold text-gray-800 text-sm">{series.name}</h4>
                                             <p className="text-xs text-gray-400">Próximo: <span className="font-mono font-bold text-blue-600">{series.prefix}{series.nextNumber.toString().padStart(series.padding || 1, '0')}</span></p>
                                          </div>
                                       </div>
                                       <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-all">
                                          <button
                                             onClick={() => setEditingSeries({ ...series })}
                                             className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                                          >
                                             <Edit2 size={16} />
                                          </button>
                                          <button
                                             onClick={() => handleDeleteSeries(series.id)}
                                             className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg"
                                          >
                                             <Trash2 size={16} />
                                          </button>
                                       </div>
                                    </div>
                                 ))}
                                 {typeSeries.length === 0 && (
                                    <div className="col-span-full py-8 text-center text-gray-400 text-sm italic">No hay series configuradas para este tipo</div>
                                 )}
                              </div>
                           </div>
                        );
                     })}
                  </div>
               )}

               {activeSubTab === 'FISCAL_POOL' && (
                  <div className="space-y-8 animate-in slide-in-from-bottom-4">

                     {/* CONSUMPTION DASHBOARD */}
                     <section className="bg-slate-900 rounded-[2.5rem] p-8 text-white shadow-xl relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl -mr-10 -mt-10"></div>
                        <div className="relative z-10">
                           <div className="flex justify-between items-end mb-8">
                              <div>
                                 <h3 className="text-xs font-black text-indigo-400 uppercase tracking-[0.2em] mb-2">Auditoría de Consumo Acumulado</h3>
                                 <p className="text-2xl font-black">NCF Consumidos por Tipo</p>
                              </div>
                              <div className="p-3 bg-white/5 rounded-2xl border border-white/10">
                                 <BarChart3 size={24} className="text-indigo-400" />
                              </div>
                           </div>

                           <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                              {(['B01', 'B02', 'B14', 'B15'] as NCFType[]).map(type => {
                                 const consumed = fiscalConsumption[type] || 0;
                                 const range = fiscalRanges.find(r => r.type === type);
                                 const totalAuthorized = range ? (range.endNumber - range.startNumber + 1) : 0;
                                 const color = type === 'B01' ? 'text-blue-400' : type === 'B02' ? 'text-emerald-400' : 'text-purple-400';

                                 const progressPct = totalAuthorized > 0 ? (consumed / totalAuthorized) * 100 : 0;

                                 return (
                                    <div key={type} className="bg-white/5 p-5 rounded-3xl border border-white/5 hover:bg-white/10 transition-colors">
                                       <div className="flex justify-between items-start mb-3">
                                          <span className={`font-black text-sm ${color}`}>{type}</span>
                                          <Activity size={14} className="opacity-30" />
                                       </div>
                                       <p className="text-3xl font-mono font-black leading-none mb-1">{consumed.toLocaleString()}</p>
                                       <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">
                                          Emitidos Totales
                                       </p>
                                       {totalAuthorized > 0 && (
                                          <div className="mt-4">
                                             <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                                                <div
                                                   className={`h-full ${color.replace('text-', 'bg-')}`}
                                                   style={{ width: `${Math.min(progressPct, 100)}%` }}
                                                ></div>
                                             </div>
                                             <p className="text-[9px] text-slate-400 mt-1 font-bold">
                                                {progressPct.toFixed(1)}% del pool
                                             </p>
                                          </div>
                                       )}
                                    </div>
                                 )
                              })}
                           </div>
                        </div>
                     </section>

                     <div className="flex justify-between items-center px-2">
                        <div>
                           <h2 className="text-xl font-bold text-gray-800">Autorizaciones DGII Vigentes</h2>
                           <p className="text-sm text-gray-500">Administra los rangos aprobados en tu oficina virtual.</p>
                        </div>
                        <button onClick={() => setIsAddingRange(true)} className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-bold shadow-lg hover:bg-indigo-700 flex items-center gap-2 active:scale-95 transition-all">
                           <Plus size={20} /> Cargar Nuevo Rango
                        </button>
                     </div>

                     <div className="grid grid-cols-1 gap-4 pb-20">
                        {fiscalRanges.map(range => {
                           const usedInCajas = Math.max(0, range.currentGlobal - (range.startNumber - 1));
                           const totalAutorizado = range.endNumber - range.startNumber + 1;
                           const progress = totalAutorizado > 0 ? (usedInCajas / totalAutorizado) * 100 : 0;
                           const disponiblesEnServidor = range.endNumber - range.currentGlobal;

                           return (
                              <div key={range.id} className={`bg-white p-6 rounded-3xl border-2 transition-all ${range.isActive ? 'border-gray-100 shadow-sm' : 'border-dashed border-gray-200 opacity-60'}`}>
                                 <div className="flex flex-col md:flex-row justify-between gap-6 mb-6">
                                    <div className="flex items-center gap-4">
                                       <div className={`p-4 rounded-2xl ${range.isActive ? 'bg-indigo-50 text-indigo-600' : 'bg-gray-100 text-gray-400'}`}>
                                          <Landmark size={28} />
                                       </div>
                                       <div>
                                          <div className="flex items-center gap-2">
                                             <span className="px-2 py-0.5 bg-indigo-600 text-white text-[10px] font-black rounded uppercase">{range.type}</span>
                                             <h3 className="font-black text-gray-800 text-lg">{range.prefix}-XXXXXXX</h3>
                                          </div>
                                          <p className="text-xs text-gray-400 flex items-center gap-1 mt-1"><Calendar size={12} /> Vence: {new Date(range.expiryDate).toLocaleDateString()}</p>
                                       </div>
                                    </div>

                                    <div className="flex-1 md:max-w-md">
                                       <div className="flex justify-between text-xs font-bold text-gray-500 uppercase mb-2">
                                          <span>Distribución a Terminales</span>
                                          <span className="text-indigo-600">{usedInCajas.toLocaleString()} / {totalAutorizado.toLocaleString()}</span>
                                       </div>
                                       <div className="h-3 bg-gray-100 rounded-full overflow-hidden border border-gray-200">
                                          <div className="h-full bg-indigo-600 transition-all duration-1000" style={{ width: `${progress}%` }}></div>
                                       </div>
                                    </div>

                                    <div className="flex items-center gap-3">
                                       <button
                                          onClick={() => handleToggleRange(range.id)}
                                          className={`w-12 h-6 rounded-full relative transition-colors ${range.isActive ? 'bg-green-500' : 'bg-gray-300'}`}
                                       >
                                          <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${range.isActive ? 'left-7' : 'left-1'}`} />
                                       </button>
                                       <button className="p-2 text-gray-300 hover:text-red-500"><Trash2 size={20} /></button>
                                    </div>
                                 </div>

                                 <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-gray-100">
                                    <div><p className="text-[10px] text-gray-400 uppercase font-bold">Rango Inicio</p><p className="font-mono font-bold text-gray-700">{range.startNumber}</p></div>
                                    <div><p className="text-[10px] text-gray-400 uppercase font-bold">Rango Fin</p><p className="font-mono font-bold text-gray-700">{range.endNumber}</p></div>
                                    <div>
                                       <p className="text-[10px] text-gray-400 uppercase font-bold">Reserva Restante Pool</p>
                                       <p className={`font-black ${disponiblesEnServidor < (totalAutorizado * 0.1) ? 'text-red-600' : 'text-emerald-600'}`}>
                                          {disponiblesEnServidor.toLocaleString()}
                                       </p>
                                    </div>
                                    <div className="text-right">
                                       <button className="text-[10px] font-black text-blue-600 uppercase hover:underline flex items-center gap-1 justify-end">
                                          Ver Detalle de Cajas <ChevronRight size={10} />
                                       </button>
                                    </div>
                                 </div>
                              </div>
                           );
                        })}
                     </div>
                  </div>
               )}

            </div>
         </div>

         {/* MODAL EDITAR/NUEVA SERIE INTERNA */}
         {editingSeries && (
            <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
               <div className="bg-white rounded-[2.5rem] w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95">
                  <div className="p-6 border-b bg-gray-50 flex justify-between items-center">
                     <h3 className="text-xl font-black text-gray-800">{seriesList.some(s => s.id === editingSeries.id) ? 'Editar Secuencia' : 'Nueva Secuencia'}</h3>
                     <button onClick={() => setEditingSeries(null)} className="p-2 hover:bg-gray-200 rounded-full"><X size={20} /></button>
                  </div>
                  <div className="p-8 space-y-6">
                     <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Tipo de Documento</label>
                        <select
                           value={editingSeries.documentType}
                           onChange={e => setEditingSeries({ ...editingSeries, documentType: e.target.value as any })}
                           className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl font-bold"
                        >
                           <optgroup label="Ventas">
                              <option value="TICKET">Ticket de Venta</option>
                              <option value="REFUND">Devolución / Abono</option>
                              <option value="VOID">Anulación</option>
                           </optgroup>
                           <optgroup label="Inventario">
                              <option value="TRANSFER">Traspaso entre Almacenes</option>
                              <option value="ADJUSTMENT_IN">Ajuste Positivo</option>
                              <option value="ADJUSTMENT_OUT">Ajuste Negativo</option>
                              <option value="PURCHASE">Compra a Proveedor</option>
                              <option value="PRODUCTION">Producción/Ensamblaje</option>
                           </optgroup>
                           <optgroup label="Efectivo">
                              <option value="CASH_IN">Entrada de Efectivo</option>
                              <option value="CASH_OUT">Salida de Efectivo</option>
                              <option value="CASH_DEPOSIT">Depósito Bancario</option>
                              <option value="CASH_WITHDRAWAL">Retiro de Caja</option>
                           </optgroup>
                           <optgroup label="Cierres">
                              <option value="Z_REPORT">Cierre de Caja (Z)</option>
                              <option value="X_REPORT">Corte Parcial (X)</option>
                           </optgroup>
                           <optgroup label="Cuentas">
                              <option value="RECEIVABLE">Cuenta por Cobrar</option>
                              <option value="PAYABLE">Cuenta por Pagar</option>
                              <option value="PAYMENT_IN">Cobro Recibido</option>
                              <option value="PAYMENT_OUT">Pago Realizado</option>
                           </optgroup>
                        </select>
                     </div>
                     <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Nombre de la Serie</label>
                        <input
                           type="text"
                           value={editingSeries.name}
                           onChange={e => setEditingSeries({ ...editingSeries, name: e.target.value })}
                           placeholder="Ej. Ticket Caja 1"
                           className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl font-bold"
                        />
                     </div>
                     <div className="grid grid-cols-2 gap-4">
                        <div>
                           <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Prefijo</label>
                           <input
                              type="text"
                              value={editingSeries.prefix}
                              onChange={e => setEditingSeries({ ...editingSeries, prefix: e.target.value.toUpperCase() })}
                              placeholder="Ej. TCK01"
                              className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl font-mono font-bold"
                           />
                        </div>
                        <div>
                           <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Próximo Número</label>
                           <input
                              type="number"
                              value={editingSeries.nextNumber}
                              onChange={e => setEditingSeries({ ...editingSeries, nextNumber: parseInt(e.target.value) || 1 })}
                              className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl font-mono font-bold text-blue-600"
                           />
                        </div>
                     </div>
                     <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Unidad de Negocio (Opcional)</label>
                        <input
                           type="text"
                           value={editingSeries.businessUnit || ''}
                           onChange={e => setEditingSeries({ ...editingSeries, businessUnit: e.target.value })}
                           placeholder="Ej. Tienda Norte, Caja Express"
                           className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl font-bold"
                        />
                     </div>
                     <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Relleno de ceros (Padding)</label>
                        <select
                           value={editingSeries.padding}
                           onChange={e => setEditingSeries({ ...editingSeries, padding: parseInt(e.target.value) })}
                           className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl font-bold"
                        >
                           <option value={0}>Sin ceros</option>
                           <option value={4}>4 dígitos (0001)</option>
                           <option value={6}>6 dígitos (000001)</option>
                           <option value={8}>8 dígitos (00000001)</option>
                        </select>
                     </div>
                  </div>
                  <div className="p-6 bg-gray-50 border-t flex gap-3">
                     <button onClick={() => setEditingSeries(null)} className="flex-1 py-3 text-gray-500 font-bold">Cancelar</button>
                     <button onClick={handleSaveInternalSeries} className="flex-[2] py-3 bg-blue-600 text-white rounded-xl font-black shadow-lg">Confirmar Serie</button>
                  </div>
               </div>
            </div>
         )}

         {/* MODAL AGREGAR RANGO FISCAL */}
         {isAddingRange && (
            <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
               <div className="bg-white rounded-[2.5rem] w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95">
                  <div className="p-6 border-b bg-gray-50 flex justify-between items-center">
                     <h3 className="text-xl font-black text-gray-800">Cargar Autorización DGII</h3>
                     <button onClick={() => setIsAddingRange(false)} className="p-2 hover:bg-gray-200 rounded-full"><X size={20} /></button>
                  </div>
                  <div className="p-8 space-y-6">
                     <div className="grid grid-cols-2 gap-4">
                        <div>
                           <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Tipo Comprobante</label>
                           <select
                              value={newRange.type}
                              onChange={(e) => setNewRange({ ...newRange, type: e.target.value as any, prefix: e.target.value })}
                              className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-bold"
                           >
                              <option value="B01">Crédito Fiscal (B01)</option>
                              <option value="B02">Consumo (B02)</option>
                              <option value="B14">Reg. Especiales (B14)</option>
                              <option value="B15">Gubernamentales (B15)</option>
                           </select>
                        </div>
                        <div>
                           <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Prefijo</label>
                           <input type="text" value={newRange.prefix} disabled className="w-full p-3 bg-gray-100 border border-gray-200 rounded-xl font-mono text-gray-500" />
                        </div>
                     </div>
                     <div className="grid grid-cols-2 gap-4">
                        <div>
                           <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Del número (Inicio)</label>
                           <input type="number" value={newRange.startNumber} onChange={e => setNewRange({ ...newRange, startNumber: parseInt(e.target.value) })} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-mono font-bold" />
                        </div>
                        <div>
                           <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Al número (Fin)</label>
                           <input type="number" value={newRange.endNumber} onChange={e => setNewRange({ ...newRange, endNumber: parseInt(e.target.value) })} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-mono font-bold" />
                        </div>
                     </div>
                     <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Vencimiento</label>
                        <input type="date" value={newRange.expiryDate} onChange={e => setNewRange({ ...newRange, expiryDate: e.target.value })} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-bold" />
                     </div>
                  </div>
                  <div className="p-6 bg-gray-50 border-t flex gap-3">
                     <button onClick={() => setIsAddingRange(false)} className="flex-1 py-3 text-gray-500 font-bold">Cancelar</button>
                     <button onClick={handleSaveRange} className="flex-[2] py-3 bg-indigo-600 text-white rounded-xl font-black shadow-lg">Guardar Autorización</button>
                  </div>
               </div>
            </div>
         )}

      </div>
   );
};

export default DocumentSettings;
