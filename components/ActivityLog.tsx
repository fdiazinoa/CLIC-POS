
import React, { useState, useMemo } from 'react';
import { 
  Search, AlertTriangle, Trash2, Unlock, User, 
  ShoppingCart, Percent, RefreshCcw, FileText, 
  Filter, CheckCircle2, AlertOctagon, XCircle 
} from 'lucide-react';

// Types specific to this component
type Severity = 'INFO' | 'WARNING' | 'CRITICAL';
type ActionType = 'SALE' | 'DELETE_ITEM' | 'VOID_TICKET' | 'OPEN_DRAWER' | 'DISCOUNT' | 'LOGIN' | 'REFUND';

interface LogEntry {
  id: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  action: ActionType;
  description: string;
  timestamp: Date;
  ticketId?: string;
  severity: Severity;
}

// Mock Data Generator
const GENERATE_LOGS = (): LogEntry[] => {
  const actions: { type: ActionType; desc: string; sev: Severity }[] = [
    { type: 'SALE', desc: 'Venta completada #T-1024', sev: 'INFO' },
    { type: 'DELETE_ITEM', desc: 'Eliminó "Coca Cola" del carrito', sev: 'WARNING' },
    { type: 'OPEN_DRAWER', desc: 'Apertura de cajón sin venta', sev: 'CRITICAL' },
    { type: 'VOID_TICKET', desc: 'Anulación total de ticket #T-1020', sev: 'CRITICAL' },
    { type: 'DISCOUNT', desc: 'Aplicó descuento manual 50%', sev: 'WARNING' },
    { type: 'LOGIN', desc: 'Inicio de sesión en POS-01', sev: 'INFO' },
    { type: 'REFUND', desc: 'Devolución de "Sandwich Mixto"', sev: 'WARNING' },
  ];

  const users = [
    { name: 'Ana Cajera', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=facearea&facepad=2&w=100&h=100&q=80' },
    { name: 'Roberto Sup.', avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=facearea&facepad=2&w=100&h=100&q=80' },
    { name: 'Carlos Mesero', avatar: null }
  ];

  return Array.from({ length: 25 }).map((_, i) => {
    const act = actions[Math.floor(Math.random() * actions.length)];
    const user = users[Math.floor(Math.random() * users.length)];
    const time = new Date();
    time.setMinutes(time.getMinutes() - (i * 15)); // Stagger times

    return {
      id: `log-${i}`,
      userId: `u-${i}`,
      userName: user.name,
      userAvatar: user.avatar || undefined,
      action: act.type,
      description: act.desc,
      timestamp: time,
      ticketId: Math.random() > 0.5 ? `T-${1000 + i}` : undefined,
      severity: act.sev
    };
  });
};

interface ActivityLogProps {
  onClose: () => void;
}

const ActivityLog: React.FC<ActivityLogProps> = ({ onClose }) => {
  const [logs] = useState<LogEntry[]>(GENERATE_LOGS());
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRiskOnly, setFilterRiskOnly] = useState(false);

  // --- FILTERS ---
  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      const matchesSearch = 
        log.userName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (log.ticketId && log.ticketId.toLowerCase().includes(searchTerm.toLowerCase()));
      
      const matchesRisk = filterRiskOnly ? (log.severity === 'WARNING' || log.severity === 'CRITICAL') : true;

      return matchesSearch && matchesRisk;
    });
  }, [logs, searchTerm, filterRiskOnly]);

  // --- UI HELPERS ---
  const getIcon = (action: ActionType) => {
    switch (action) {
      case 'DELETE_ITEM': return <Trash2 size={16} />;
      case 'OPEN_DRAWER': return <Unlock size={16} />;
      case 'VOID_TICKET': return <XCircle size={16} />;
      case 'DISCOUNT': return <Percent size={16} />;
      case 'REFUND': return <RefreshCcw size={16} />;
      case 'SALE': return <ShoppingCart size={16} />;
      default: return <FileText size={16} />;
    }
  };

  const getSeverityStyles = (severity: Severity) => {
    switch (severity) {
      case 'CRITICAL': return 'bg-red-100 text-red-600 border-red-200';
      case 'WARNING': return 'bg-orange-100 text-orange-600 border-orange-200';
      default: return 'bg-blue-50 text-blue-600 border-blue-100';
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 animate-in slide-in-from-right-10 duration-300">
      
      {/* Header */}
      <div className="bg-white px-8 py-6 border-b border-slate-200 flex flex-col md:flex-row justify-between items-center gap-4 shrink-0 shadow-sm z-10">
        <div>
          <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
             <AlertOctagon className="text-slate-900" /> Auditoría & Traza
          </h1>
          <p className="text-sm text-slate-500">Registro detallado de acciones para control de seguridad.</p>
        </div>
        
        <div className="flex gap-3 w-full md:w-auto">
           {/* Search */}
           <div className="relative flex-1 md:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input 
                 type="text" 
                 placeholder="Buscar ticket, usuario..." 
                 value={searchTerm}
                 onChange={(e) => setSearchTerm(e.target.value)}
                 className="w-full pl-10 pr-4 py-2.5 bg-slate-100 border-none rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:shadow-sm outline-none transition-all text-sm font-medium"
              />
           </div>

           {/* Risk Filter Toggle */}
           <button 
              onClick={() => setFilterRiskOnly(!filterRiskOnly)}
              className={`px-4 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-all border ${
                 filterRiskOnly 
                    ? 'bg-red-50 text-red-600 border-red-200 shadow-sm' 
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
           >
              <AlertTriangle size={18} className={filterRiskOnly ? 'fill-current' : ''} />
              <span className="hidden sm:inline">Solo Riesgos</span>
           </button>
        </div>
      </div>

      {/* Timeline Content */}
      <div className="flex-1 overflow-y-auto p-6 md:p-8">
         <div className="max-w-4xl mx-auto">
            
            {filteredLogs.length === 0 ? (
               <div className="text-center py-20 opacity-50">
                  <FileText size={64} className="mx-auto mb-4 text-slate-300" />
                  <p className="text-lg font-bold text-slate-500">No se encontraron eventos</p>
                  <p className="text-sm text-slate-400">Intenta cambiar los filtros de búsqueda.</p>
               </div>
            ) : (
               <div className="relative pl-8 space-y-8 before:absolute before:inset-0 before:ml-3 before:h-full before:w-0.5 before:-translate-x-px before:bg-gradient-to-b before:from-slate-200 before:via-slate-200 before:to-transparent">
                  {filteredLogs.map((log) => (
                     <div key={log.id} className="relative group">
                        
                        {/* Timeline Connector Dot */}
                        <div className={`absolute left-0 -ml-8 mt-1.5 h-6 w-6 rounded-full border-4 border-white shadow-sm flex items-center justify-center z-10 ${
                           log.severity === 'CRITICAL' ? 'bg-red-500' : 
                           log.severity === 'WARNING' ? 'bg-orange-500' : 'bg-blue-500'
                        }`}>
                        </div>

                        {/* Card */}
                        <div className={`bg-white rounded-2xl p-5 shadow-sm border transition-all hover:shadow-md ${log.severity === 'CRITICAL' ? 'border-red-100' : 'border-slate-100'}`}>
                           <div className="flex items-start justify-between gap-4">
                              
                              <div className="flex items-start gap-4">
                                 {/* Avatar */}
                                 <div className="relative shrink-0">
                                    {log.userAvatar ? (
                                       <img src={log.userAvatar} alt={log.userName} className="w-10 h-10 rounded-xl object-cover shadow-sm" />
                                    ) : (
                                       <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500">
                                          <User size={20} />
                                       </div>
                                    )}
                                    <div className="absolute -bottom-1 -right-1 bg-white rounded-full p-0.5">
                                       <div className={`p-1 rounded-full ${getSeverityStyles(log.severity)}`}>
                                          {getIcon(log.action)}
                                       </div>
                                    </div>
                                 </div>

                                 {/* Content */}
                                 <div>
                                    <div className="flex items-center gap-2 mb-1">
                                       <span className="font-bold text-slate-800 text-sm">{log.userName}</span>
                                       <span className="text-slate-300 text-xs">•</span>
                                       <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{log.action.replace('_', ' ')}</span>
                                    </div>
                                    <p className={`text-sm font-medium leading-relaxed ${log.severity === 'CRITICAL' ? 'text-red-700' : 'text-slate-600'}`}>
                                       {log.description}
                                    </p>
                                    {log.ticketId && (
                                       <span className="inline-block mt-2 px-2 py-0.5 bg-slate-100 text-slate-500 text-[10px] font-mono rounded border border-slate-200">
                                          {log.ticketId}
                                       </span>
                                    )}
                                 </div>
                              </div>

                              {/* Time */}
                              <div className="text-right shrink-0">
                                 <p className="text-xs font-bold text-slate-400">
                                    {log.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                 </p>
                                 <p className="text-[10px] text-slate-300">
                                    {log.timestamp.toLocaleDateString()}
                                 </p>
                              </div>

                           </div>
                        </div>
                     </div>
                  ))}
               </div>
            )}
         </div>
      </div>

    </div>
  );
};

export default ActivityLog;
