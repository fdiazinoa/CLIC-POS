
import React, { useState } from 'react';
import {
   Download, FileSpreadsheet, FileText, Calendar,
   Lock, ShieldAlert, CheckCircle2, ChevronRight,
   Database, FileJson, HardDrive, LogOut, KeyRound, Delete, RefreshCw, ArrowLeft
} from 'lucide-react';
import { db } from '../utils/db'; // Import DB to call reset
import { dbAdapter } from '../services/db';
import FactoryResetModal, { ResetCategory } from './FactoryResetModal';
import { ExportUtils } from '../utils/ExportUtils';

import { BusinessConfig } from '../types';

interface DataSecurityHubProps {
   onClose: () => void;
   terminalId: string;
   config: BusinessConfig;
}

const DataSecurityHub: React.FC<DataSecurityHubProps> = ({ onClose, terminalId, config }) => {
   // --- STATE ---
   const [dateRange, setDateRange] = useState({
      start: new Date().toISOString().split('T')[0],
      end: new Date().toISOString().split('T')[0]
   });

   // Kiosk Mode State
   const [isLocked, setIsLocked] = useState(false);
   const [pin, setPin] = useState('');
   const [error, setError] = useState(false);
   const [showResetModal, setShowResetModal] = useState(false);
   const [dbStats, setDbStats] = useState<{ type: string; size: number; tables: number } | null>(null);

   React.useEffect(() => {
      const loadStats = async () => {
         if (dbAdapter.getStats) {
            const stats = await dbAdapter.getStats();
            setDbStats(stats);
         }
      };
      loadStats();
   }, []);

   // --- HANDLERS ---

   const handleExport = async (type: string, format: string) => {
      try {
         let data: any[] = [];
         let fileName = `${type}_${dateRange.start}_${dateRange.end}`;

         if (type === 'sales') {
            const allTransactions = await db.get('transactions') || [];
            // Filter by date range
            data = allTransactions.filter((t: any) => {
               const date = t.createdAt.split('T')[0];
               return date >= dateRange.start && date <= dateRange.end;
            });
         } else if (type === 'catalog') {
            data = await db.get('products') || [];
            fileName = `catalogo_productos_${new Date().toISOString().split('T')[0]}`;
         } else if (type === 'customers') {
            data = await db.get('customers') || [];
            fileName = `base_clientes_${new Date().toISOString().split('T')[0]}`;
         }

         if (data.length === 0) {
            alert('No hay datos para exportar en el rango seleccionado.');
            return;
         }

         if (format === 'CSV') {
            ExportUtils.exportAsCsv(data, fileName);
         } else if (format === 'JSON') {
            ExportUtils.exportAsJson(data, fileName);
         } else {
            alert(`El formato ${format} no está implementado aún.`);
         }
      } catch (error: any) {
         console.error('Export error:', error);
         alert(`Error al exportar: ${error.message}`);
      }
   };

   const handleLock = () => {
      if (confirm("¿Activar Modo Kiosco? El terminal quedará bloqueado.")) {
         setIsLocked(true);
      }
   };

   const handleFactoryReset = async (categories: ResetCategory[]) => {
      setShowResetModal(false);

      if (categories.length === 0) {
         alert('No se seleccionaron categorías para eliminar.');
         return;
      }

      // Determine if this is a slave terminal
      const isSlave = config.terminals.find(t => t.id === terminalId)?.config.isPrimaryNode === false;

      // Final confirmation
      const categoryNames = categories.map(c => c.name).join(', ');
      const confirmMsg = isSlave
         ? `¿CONFIRMAR ELIMINACIÓN PARA TERMINAL ${terminalId}?\n\nSe eliminarán: ${categoryNames}\n\nSolo se borrarán los datos locales de esta terminal. Esta acción NO se puede deshacer.`
         : `¿CONFIRMAR ELIMINACIÓN GLOBAL?\n\nSe eliminarán: ${categoryNames}\n\nEsta acción NO se puede deshacer.`;

      if (!confirm(confirmMsg)) {
         return;
      }

      try {
         // Call selective delete
         await db.selectiveReset(categories, terminalId, isSlave);
         alert(`✅ Datos eliminados: ${categoryNames}`);
         window.location.reload();
      } catch (error: any) {
         alert(`❌ Error: ${error.message}`);
      }
   };

   const handlePinPress = (key: string) => {
      setError(false);
      if (key === 'C') {
         setPin('');
      } else if (key === 'BACK') {
         setPin(prev => prev.slice(0, -1));
      } else {
         if (pin.length < 6) {
            const newPin = pin + key;
            setPin(newPin);

            // Auto-check 6 digits Master PIN (Mock: 123456)
            if (newPin.length === 6) {
               if (newPin === '123456') {
                  setTimeout(() => {
                     setIsLocked(false);
                     setPin('');
                  }, 200);
               } else {
                  setTimeout(() => {
                     setError(true);
                     setPin('');
                  }, 300);
               }
            }
         }
      }
   };

   // --- RENDER LOCK SCREEN (OVERLAY) ---
   if (isLocked) {
      return (
         <div className="fixed inset-0 z-[100] bg-slate-900 flex flex-col items-center justify-center p-6 animate-in fade-in duration-300">
            <div className="w-full max-w-sm flex flex-col items-center">
               <div className="mb-8 p-6 bg-slate-800 rounded-full shadow-2xl shadow-blue-900/20 border-4 border-slate-700 animate-pulse">
                  <Lock size={64} className="text-blue-500" />
               </div>

               <h2 className="text-3xl font-black text-white mb-2 tracking-tight">Terminal Bloqueado</h2>
               <p className="text-slate-400 mb-8 text-center">Modo Kiosco Activo. Ingrese PIN Maestro para desbloquear.</p>

               {/* PIN Indicator */}
               <div className={`flex gap-4 mb-8 h-8 ${error ? 'animate-shake' : ''}`}>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                     <div
                        key={i}
                        className={`w-4 h-4 rounded-full transition-all duration-200 border-2 ${pin.length > i
                           ? error ? 'bg-red-500 border-red-500' : 'bg-blue-500 border-blue-500 scale-110'
                           : 'bg-transparent border-slate-600'
                           }`}
                     />
                  ))}
               </div>
               {error && <p className="text-red-500 font-bold mb-4 animate-in fade-in">PIN Incorrecto</p>}

               {/* Numpad */}
               <div className="grid grid-cols-3 gap-4 w-full">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                     <button
                        key={num}
                        onClick={() => handlePinPress(num.toString())}
                        className="h-20 bg-slate-800 rounded-2xl text-2xl font-bold text-white hover:bg-slate-700 active:bg-blue-600 active:scale-95 transition-all shadow-lg border-b-4 border-slate-900"
                     >
                        {num}
                     </button>
                  ))}
                  <button onClick={() => handlePinPress('C')} className="h-20 bg-slate-800/50 rounded-2xl text-xl font-bold text-red-400 hover:bg-slate-800 transition-all">C</button>
                  <button onClick={() => handlePinPress('0')} className="h-20 bg-slate-800 rounded-2xl text-2xl font-bold text-white hover:bg-slate-700 active:bg-blue-600 active:scale-95 transition-all shadow-lg border-b-4 border-slate-900">0</button>
                  <button onClick={() => handlePinPress('BACK')} className="h-20 bg-slate-800/50 rounded-2xl flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition-all"><Delete size={24} /></button>
               </div>
            </div>
            <div className="absolute bottom-6 text-slate-600 text-xs font-mono">
               CLIC OS Secure Lock v2.4
            </div>
         </div>
      );
   }

   // --- RENDER MAIN UI ---
   return (
      <div className="flex-1 overflow-y-auto p-4 md:p-8 animate-in slide-in-from-right-10 duration-300 w-full">
         <div className="max-w-6xl mx-auto space-y-8 pb-20">

            {/* 1. DATA EXPORT SECTION */}
            <section>
               <div className="flex flex-col md:flex-row md:items-end justify-between mb-6 gap-4">
                  <div>
                     <button onClick={onClose} className="mb-2 flex items-center gap-2 text-gray-400 hover:text-gray-700 transition-colors font-bold text-sm">
                        <ArrowLeft size={18} /> Volver
                     </button>
                     <h2 className="text-2xl font-black text-gray-800 flex items-center gap-3">
                        <Database className="text-blue-600" /> Centro de Datos
                     </h2>
                     <p className="text-gray-500 mt-1">Exporta registros históricos y catálogos maestros.</p>
                  </div>

                  {/* Modern Date Picker */}
                  <div className="flex items-center gap-2 bg-white p-2 rounded-2xl border border-gray-200 shadow-sm w-full md:w-auto mt-2 md:mt-0">
                     <div className="px-3 py-2 bg-gray-50 rounded-xl flex-1 md:flex-none">
                        <span className="text-[10px] font-bold text-gray-400 uppercase block">Desde</span>
                        <input
                           type="date"
                           value={dateRange.start}
                           onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                           className="bg-transparent text-sm font-bold text-gray-700 outline-none w-full md:w-32"
                        />
                     </div>
                     <div className="text-gray-300"><ChevronRight size={20} /></div>
                     <div className="px-3 py-2 bg-gray-50 rounded-xl flex-1 md:flex-none">
                        <span className="text-[10px] font-bold text-gray-400 uppercase block">Hasta</span>
                        <input
                           type="date"
                           value={dateRange.end}
                           onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                           className="bg-transparent text-sm font-bold text-gray-700 outline-none w-full md:w-32"
                        />
                     </div>
                  </div>
               </div>

               {/* DB Stats Card */}
               <div className="bg-slate-900 rounded-3xl p-6 text-white mb-8 flex flex-col md:flex-row items-center justify-between shadow-xl">
                  <div className="flex items-center gap-4 mb-4 md:mb-0">
                     <div className="p-3 bg-blue-500/20 rounded-xl border border-blue-500/30">
                        <HardDrive size={24} className="text-blue-400" />
                     </div>
                     <div>
                        <h3 className="font-bold text-lg">Estado de Base de Datos</h3>
                        <p className="text-slate-400 text-sm">{dbStats ? dbStats.type : 'Cargando...'}</p>
                     </div>
                  </div>

                  <div className="flex flex-wrap gap-4 md:gap-8 justify-center md:justify-end w-full md:w-auto">
                     <div className="text-center min-w-[80px]">
                        <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-1">Tamaño</p>
                        <p className="text-xl font-mono font-bold text-emerald-400">
                           {dbStats ? (dbStats.size / 1024 / 1024).toFixed(2) : '0.00'} MB
                        </p>
                     </div>
                     <div className="text-center min-w-[80px]">
                        <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-1">Tablas</p>
                        <p className="text-xl font-mono font-bold text-blue-400">
                           {dbStats ? dbStats.tables : '0'}
                        </p>
                     </div>
                     <div className="text-center min-w-[80px]">
                        <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-1">Estado</p>
                        <div className="flex items-center gap-2 justify-center">
                           <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                           <span className="text-sm font-bold text-emerald-500">Online</span>
                        </div>
                     </div>
                  </div>
               </div>

               <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Card 1: Sales */}
                  <ExportCard
                     title="Ventas del Período"
                     description="Transacciones detalladas, métodos de pago y totales."
                     icon={FileText}
                     color="blue"
                     options={['CSV', 'PDF', 'XLS']}
                     onExport={(fmt) => handleExport('sales', fmt)}
                  />
                  {/* Card 2: Catalog */}
                  <ExportCard
                     title="Catálogo de Productos"
                     description="Inventario actual, costos, precios y variantes."
                     icon={FileSpreadsheet}
                     color="emerald"
                     options={['CSV', 'JSON']}
                     onExport={(fmt) => handleExport('catalog', fmt)}
                  />
                  {/* Card 3: Customers */}
                  <ExportCard
                     title="Base de Clientes"
                     description="Listado CRM, puntos de fidelidad y deudas."
                     icon={FileSpreadsheet}
                     color="purple"
                     options={['CSV']}
                     onExport={(fmt) => handleExport('customers', fmt)}
                  />
               </div>
            </section>

            <div className="w-full h-px bg-gray-200 my-8"></div>

            {/* 2. SECURITY SECTION */}
            <section>
               <div className="mb-6">
                  <h2 className="text-2xl font-black text-gray-800 flex items-center gap-3">
                     <ShieldAlert className="text-red-600" /> Seguridad de Terminal
                  </h2>
                  <p className="text-gray-500 mt-1">Gestión de acceso y bloqueo para entorno público.</p>
               </div>

               <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-3xl p-8 text-white shadow-xl flex flex-col justify-between relative overflow-hidden">
                     {/* Deco Bg */}
                     <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>

                     <div className="relative z-10 mb-6">
                        <div className="flex items-center gap-3 mb-3">
                           <div className="p-2 bg-red-500/20 rounded-lg text-red-400 border border-red-500/30">
                              <Lock size={24} />
                           </div>
                           <h3 className="text-xl font-bold">Modo Kiosco</h3>
                        </div>
                        <p className="text-gray-400 text-sm leading-relaxed">
                           Bloquea la interfaz para impedir salir de la aplicación. Se requiere PIN Maestro para desbloquear.
                        </p>
                     </div>

                     <button
                        onClick={handleLock}
                        className="relative z-10 w-full py-4 bg-red-600 hover:bg-red-50 text-white rounded-2xl font-bold text-lg shadow-lg shadow-red-900/50 flex items-center justify-center gap-3 transition-transform active:scale-95 group"
                     >
                        <KeyRound size={24} className="group-hover:rotate-12 transition-transform" />
                        Bloquear Terminal
                     </button>
                  </div>

                  <div className="bg-white rounded-3xl p-8 border border-gray-200 flex flex-col justify-between">
                     <div>
                        <h3 className="text-xl font-bold text-gray-800 mb-2 flex items-center gap-2">
                           <RefreshCw className="text-orange-500" /> Reinicio de Fábrica
                        </h3>
                        <p className="text-gray-500 text-sm mb-6">
                           Borra todos los datos locales y restaura el escenario de prueba inicial. Útil si la base de datos se corrompe.
                        </p>
                     </div>
                     <button
                        onClick={() => setShowResetModal(true)}
                        className="w-full py-4 bg-white border-2 border-orange-200 text-orange-600 hover:bg-orange-50 hover:border-orange-300 rounded-2xl font-bold text-lg transition-all flex items-center justify-center gap-3"
                     >
                        <Delete size={20} /> Resetear Datos (Semilla)
                     </button>
                  </div>
               </div>
            </section>

            {/* 3. RESET MODAL */}
            {showResetModal && (
               <FactoryResetModal
                  onClose={() => setShowResetModal(false)}
                  onConfirm={handleFactoryReset}
               />
            )}

         </div>
      </div>
   );
};

// Helper Subcomponent for Export Cards
const ExportCard: React.FC<{
   title: string;
   description: string;
   icon: React.ElementType;
   color: 'blue' | 'emerald' | 'purple';
   options: string[];
   onExport: (fmt: string) => void;
}> = ({ title, description, icon: Icon, color, options, onExport }) => {

   const colors = {
      blue: 'bg-blue-100 text-blue-600',
      emerald: 'bg-emerald-100 text-emerald-600',
      purple: 'bg-purple-100 text-purple-600',
   };

   return (
      <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow flex flex-col h-full">
         <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 ${colors[color]}`}>
            <Icon size={24} />
         </div>
         <h3 className="font-bold text-lg text-gray-800 mb-2">{title}</h3>
         <p className="text-sm text-gray-500 mb-6 flex-1">{description}</p>

         <div className="flex flex-wrap gap-2">
            {options.map(opt => (
               <button
                  key={opt}
                  onClick={() => onExport(opt)}
                  className="flex-1 min-h-[44px] py-2 px-3 rounded-xl border border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-xs font-bold text-gray-600 flex items-center justify-center gap-1 transition-all active:scale-95"
               >
                  <Download size={14} /> {opt}
               </button>
            ))}
         </div>
      </div>
   );
};

export default DataSecurityHub;
