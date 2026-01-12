
import React, { useState } from 'react';
import { 
  FileText, Receipt, RotateCcw, FileSpreadsheet, 
  Edit2, Check, X, AlertTriangle, ShieldAlert, 
  ArrowRight, Hash, Type
} from 'lucide-react';

interface DocumentSeries {
  id: string;
  name: string;
  description: string;
  prefix: string;
  nextNumber: number;
  padding: number;
  icon: React.ElementType;
  color: string; // Tailwind color class prefix (e.g. 'blue', 'emerald')
}

// Mock Data
const INITIAL_SERIES: DocumentSeries[] = [
  { id: 'TICKET', name: 'Ticket de Venta', description: 'Comprobante estándar para clientes finales.', prefix: 'TCK', nextNumber: 1042, padding: 6, icon: Receipt, color: 'blue' },
  { id: 'INVOICE', name: 'Factura Fiscal', description: 'Documento con valor fiscal (B01).', prefix: 'B01', nextNumber: 85, padding: 8, icon: FileText, color: 'indigo' },
  { id: 'REFUND', name: 'Devolución / Abono', description: 'Notas de crédito por devoluciones.', prefix: 'NC', nextNumber: 12, padding: 6, icon: RotateCcw, color: 'orange' },
  { id: 'QUOTE', name: 'Presupuesto', description: 'Cotizaciones previas a la venta.', prefix: 'COT', nextNumber: 340, padding: 5, icon: FileSpreadsheet, color: 'emerald' },
];

interface DocumentSettingsProps {
  onClose: () => void;
}

const DocumentSettings: React.FC<DocumentSettingsProps> = ({ onClose }) => {
  const [seriesList, setSeriesList] = useState<DocumentSeries[]>(INITIAL_SERIES);
  const [editingSeries, setEditingSeries] = useState<DocumentSeries | null>(null);
  
  // Reset Safety State
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetSafetyCheck, setResetSafetyCheck] = useState(false);

  // --- HANDLERS ---

  const handleEdit = (series: DocumentSeries) => {
    setEditingSeries({ ...series });
    setShowResetConfirm(false);
    setResetSafetyCheck(false);
  };

  const handleSave = () => {
    if (!editingSeries) return;
    setSeriesList(prev => prev.map(s => s.id === editingSeries.id ? editingSeries : s));
    setEditingSeries(null);
  };

  const handleResetCounter = () => {
    if (!editingSeries) return;
    setEditingSeries({ ...editingSeries, nextNumber: 1 });
    setShowResetConfirm(false);
    setResetSafetyCheck(false);
  };

  // --- HELPERS ---

  const formatPreview = (prefix: string, num: number, padding: number) => {
    return `${prefix}-${num.toString().padStart(padding, '0')}`;
  };

  const getColorClasses = (color: string) => {
    const map: Record<string, string> = {
      blue: 'bg-blue-50 text-blue-600 border-blue-200',
      indigo: 'bg-indigo-50 text-indigo-600 border-indigo-200',
      orange: 'bg-orange-50 text-orange-600 border-orange-200',
      emerald: 'bg-emerald-50 text-emerald-600 border-emerald-200',
    };
    return map[color] || map.blue;
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 animate-in fade-in slide-in-from-right-10 duration-300">
      
      {/* Header */}
      <div className="bg-white px-8 py-6 border-b border-gray-200 flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
             <FileText className="text-slate-900" /> Document Center
          </h1>
          <p className="text-sm text-gray-500">Gestión de series, numeración y tipos de comprobantes.</p>
        </div>
        <button 
          onClick={onClose}
          className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X size={24} />
        </button>
      </div>

      <div className="flex-1 overflow-hidden p-8">
        <div className="max-w-6xl mx-auto h-full flex flex-col lg:flex-row gap-8">
           
           {/* LEFT: LIST */}
           <div className="flex-1 overflow-y-auto space-y-4 pr-2">
              {seriesList.map((series) => {
                 const colors = getColorClasses(series.color);
                 const isEditing = editingSeries?.id === series.id;

                 return (
                    <div 
                      key={series.id}
                      onClick={() => handleEdit(series)}
                      className={`group p-5 rounded-2xl border-2 transition-all cursor-pointer flex items-center justify-between ${
                        isEditing 
                           ? 'bg-white border-blue-500 shadow-lg ring-4 ring-blue-500/10' 
                           : 'bg-white border-gray-100 hover:border-blue-200 hover:shadow-md'
                      }`}
                    >
                       <div className="flex items-center gap-4">
                          <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${colors}`}>
                             <series.icon size={24} />
                          </div>
                          <div>
                             <h3 className="font-bold text-gray-800 text-lg">{series.name}</h3>
                             <p className="text-xs text-gray-400 font-medium">{series.description}</p>
                             <div className="mt-2 flex items-center gap-2">
                                <span className="bg-gray-100 text-gray-600 text-[10px] font-mono px-2 py-0.5 rounded border border-gray-200">
                                   Ult: {formatPreview(series.prefix, series.nextNumber - 1, series.padding)}
                                </span>
                             </div>
                          </div>
                       </div>
                       
                       <div className="opacity-0 group-hover:opacity-100 transition-opacity text-blue-500">
                          <Edit2 size={20} />
                       </div>
                    </div>
                 );
              })}
           </div>

           {/* RIGHT: EDITOR */}
           <div className="w-full lg:w-[480px] bg-white rounded-3xl shadow-xl border border-gray-200 flex flex-col overflow-hidden relative">
              {editingSeries ? (
                 <>
                    <div className={`p-6 border-b border-gray-100 ${getColorClasses(editingSeries.color).split(' ')[0]}`}>
                       <div className="flex items-center gap-3 mb-2">
                          <editingSeries.icon className={`w-6 h-6 ${getColorClasses(editingSeries.color).split(' ')[1]}`} />
                          <h2 className="text-xl font-black text-gray-800">Editar Serie</h2>
                       </div>
                       <p className="text-sm text-gray-600 font-medium opacity-80">Configura el formato de {editingSeries.name}</p>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-6 space-y-8">
                       
                       {/* PREVIEW BOX */}
                       <div className="bg-slate-900 rounded-2xl p-6 text-center shadow-inner relative overflow-hidden group">
                          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                             <FileText size={80} className="text-white" />
                          </div>
                          <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-2">Vista Previa Próximo Documento</p>
                          <div className="text-3xl font-mono font-bold text-white tracking-wider">
                             <span className="text-blue-400">{editingSeries.prefix}</span>
                             <span className="text-slate-600">-</span>
                             <span className="text-white">{editingSeries.nextNumber.toString().padStart(editingSeries.padding, '0')}</span>
                          </div>
                       </div>

                       {/* INPUTS */}
                       <div className="grid grid-cols-2 gap-4">
                          <div className="col-span-2">
                             <label className="block text-xs font-bold text-gray-400 uppercase mb-1 flex items-center gap-1">
                                <Type size={14} /> Prefijo
                             </label>
                             <input 
                                type="text" 
                                value={editingSeries.prefix}
                                onChange={(e) => setEditingSeries({...editingSeries, prefix: e.target.value.toUpperCase()})}
                                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-800 focus:ring-2 focus:ring-blue-500 outline-none uppercase"
                             />
                          </div>

                          <div>
                             <label className="block text-xs font-bold text-gray-400 uppercase mb-1 flex items-center gap-1">
                                <Hash size={14} /> Contador
                             </label>
                             <input 
                                type="number" 
                                value={editingSeries.nextNumber}
                                onChange={(e) => setEditingSeries({...editingSeries, nextNumber: parseInt(e.target.value) || 0})}
                                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-800 focus:ring-2 focus:ring-blue-500 outline-none"
                             />
                          </div>

                          <div>
                             <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Ceros (Padding)</label>
                             <select 
                                value={editingSeries.padding}
                                onChange={(e) => setEditingSeries({...editingSeries, padding: parseInt(e.target.value)})}
                                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-800 focus:ring-2 focus:ring-blue-500 outline-none"
                             >
                                {[4,5,6,8,10].map(n => <option key={n} value={n}>{n} dígitos</option>)}
                             </select>
                          </div>
                       </div>

                       <div className="h-px bg-gray-100 my-4"></div>

                       {/* DANGER ZONE: RESET */}
                       <div>
                          <h4 className="text-sm font-bold text-red-600 mb-3 flex items-center gap-2">
                             <ShieldAlert size={16} /> Zona de Peligro
                          </h4>
                          
                          {!showResetConfirm ? (
                             <button 
                                onClick={() => setShowResetConfirm(true)}
                                className="w-full py-3 border border-red-200 bg-red-50 text-red-600 rounded-xl font-bold text-sm hover:bg-red-100 transition-colors flex items-center justify-center gap-2"
                             >
                                <RotateCcw size={16} /> Reiniciar Numeración (Año Fiscal)
                             </button>
                          ) : (
                             <div className="bg-red-50 border border-red-200 rounded-xl p-4 animate-in zoom-in-95">
                                <p className="text-xs text-red-800 font-medium mb-3">
                                   ¿Estás seguro? Esto reiniciará el contador a <strong>1</strong>. Esto puede causar duplicidad de documentos si no se ha cambiado el prefijo.
                                </p>
                                <label className="flex items-center gap-2 mb-4 cursor-pointer">
                                   <div className={`w-5 h-5 border-2 rounded flex items-center justify-center transition-colors ${resetSafetyCheck ? 'bg-red-600 border-red-600' : 'border-red-300 bg-white'}`}>
                                      {resetSafetyCheck && <Check size={14} className="text-white" />}
                                   </div>
                                   <input type="checkbox" className="hidden" checked={resetSafetyCheck} onChange={() => setResetSafetyCheck(!resetSafetyCheck)} />
                                   <span className="text-xs font-bold text-red-700">Entiendo los riesgos.</span>
                                </label>
                                <div className="flex gap-2">
                                   <button onClick={() => { setShowResetConfirm(false); setResetSafetyCheck(false); }} className="flex-1 py-2 bg-white border border-red-200 text-red-600 rounded-lg text-xs font-bold">Cancelar</button>
                                   <button 
                                      onClick={handleResetCounter}
                                      disabled={!resetSafetyCheck}
                                      className="flex-1 py-2 bg-red-600 text-white rounded-lg text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:bg-red-700"
                                   >
                                      Confirmar Reset
                                   </button>
                                </div>
                             </div>
                          )}
                       </div>
                    </div>

                    <div className="p-6 border-t border-gray-100 bg-gray-50 flex gap-3">
                       <button onClick={() => setEditingSeries(null)} className="flex-1 py-3 text-gray-500 font-bold hover:bg-gray-200 rounded-xl transition-colors">
                          Cancelar
                       </button>
                       <button onClick={handleSave} className="flex-[2] py-3 bg-blue-600 text-white font-bold rounded-xl shadow-lg hover:bg-blue-500 transition-all active:scale-95 flex items-center justify-center gap-2">
                          <Check size={20} /> Guardar Cambios
                       </button>
                    </div>
                 </>
              ) : (
                 <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-10 text-center">
                    <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                       <FileText size={40} className="opacity-50" />
                    </div>
                    <h3 className="font-bold text-gray-600 text-lg">Selecciona un Documento</h3>
                    <p className="text-sm max-w-xs mt-2">Haz click en una tarjeta de la izquierda para editar su prefijo y numeración.</p>
                 </div>
              )}
           </div>

        </div>
      </div>

    </div>
  );
};

export default DocumentSettings;
