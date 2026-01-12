
import React, { useState, useEffect } from 'react';
import { 
  Wifi, WifiOff, RefreshCw, CheckCircle, Cloud, 
  Database, ArrowUp, X, ShieldCheck, Server, 
  FileText, Activity, AlertTriangle
} from 'lucide-react';

interface SyncStatusHubProps {
  onClose: () => void;
}

type SyncState = 'SYNCED' | 'SYNCING' | 'OFFLINE';

const SyncStatusHub: React.FC<SyncStatusHubProps> = ({ onClose }) => {
  // Simulation State
  const [status, setStatus] = useState<SyncState>('SYNCED');
  const [lastSync, setLastSync] = useState<Date>(new Date());
  const [pendingItems, setPendingItems] = useState(0);
  const [progress, setProgress] = useState(0);
  
  // Fake Stats
  const [latency, setLatency] = useState(24); // ms

  // --- HANDLERS ---

  const handleForceSync = () => {
    if (status === 'OFFLINE') {
      alert("No hay conexión a internet. Verifique su red.");
      return;
    }
    
    setStatus('SYNCING');
    setProgress(0);

    // Simulate upload process
    const interval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setStatus('SYNCED');
          setLastSync(new Date());
          setPendingItems(0);
          return 100;
        }
        return prev + 5; // increment speed
      });
    }, 100);
  };

  const toggleSimulationMode = () => {
    if (status === 'OFFLINE') {
      setStatus('SYNCED');
      setPendingItems(0);
    } else {
      setStatus('OFFLINE');
      setPendingItems(12); // Simulate items stuck in queue
    }
  };

  // --- RENDER HELPERS ---

  const getStatusColor = () => {
    switch (status) {
      case 'SYNCED': return 'bg-emerald-500 shadow-emerald-200';
      case 'SYNCING': return 'bg-blue-500 shadow-blue-200';
      case 'OFFLINE': return 'bg-red-500 shadow-red-200';
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'SYNCED': return <CheckCircle size={64} className="text-white drop-shadow-md" />;
      case 'SYNCING': return <RefreshCw size={64} className="text-white animate-spin drop-shadow-md" />;
      case 'OFFLINE': return <WifiOff size={64} className="text-white drop-shadow-md" />;
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'SYNCED': return 'Todo Sincronizado';
      case 'SYNCING': return 'Sincronizando...';
      case 'OFFLINE': return 'Modo Offline';
    }
  };

  const getStatusSubtext = () => {
    switch (status) {
      case 'SYNCED': return 'Sus datos están seguros en la nube.';
      case 'SYNCING': return 'Subiendo cambios recientes...';
      case 'OFFLINE': return 'Datos guardados localmente. Se subirán al reconectar.';
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 animate-in fade-in slide-in-from-right-10 duration-300">
      
      {/* Header */}
      <div className="bg-white px-8 py-6 border-b border-gray-200 flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
             <Cloud className="text-blue-500" /> Estado de Conexión
          </h1>
          <p className="text-sm text-gray-500">Monitor de red y respaldo de datos en tiempo real.</p>
        </div>
        
        <div className="flex items-center gap-4">
           {/* Simulation Toggle (For Demo) */}
           <button 
             onClick={toggleSimulationMode}
             className="px-3 py-1 bg-gray-100 rounded text-xs font-mono text-gray-500 hover:bg-gray-200"
           >
             Simular: {status === 'OFFLINE' ? 'Conectar' : 'Desconectar'}
           </button>

           <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors">
              <X size={24} />
           </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-4xl mx-auto flex flex-col gap-8">
           
           {/* CENTRAL INDICATOR CARD */}
           <div className="bg-white rounded-[2.5rem] shadow-xl border border-gray-100 p-10 flex flex-col items-center justify-center relative overflow-hidden">
              
              {/* Background Glow */}
              <div className={`absolute top-0 left-0 w-full h-2 bg-gradient-to-r ${status === 'SYNCED' ? 'from-emerald-400 to-green-500' : status === 'OFFLINE' ? 'from-red-500 to-orange-500' : 'from-blue-400 to-indigo-500'}`}></div>

              {/* Status Circle */}
              <div className={`w-40 h-40 rounded-full flex items-center justify-center mb-6 shadow-2xl transition-all duration-500 ${getStatusColor()} ${status === 'SYNCED' ? 'scale-100' : 'scale-105'}`}>
                 {getStatusIcon()}
              </div>

              <h2 className={`text-3xl font-black mb-2 transition-colors ${status === 'OFFLINE' ? 'text-red-600' : 'text-gray-800'}`}>
                 {getStatusText()}
              </h2>
              <p className="text-gray-500 font-medium text-lg text-center max-w-md">
                 {getStatusSubtext()}
              </p>

              {/* Progress Bar (Only when syncing) */}
              {status === 'SYNCING' && (
                 <div className="w-full max-w-xs mt-6 bg-gray-100 h-2 rounded-full overflow-hidden">
                    <div className="bg-blue-500 h-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
                 </div>
              )}

              {/* Last Sync Badge */}
              {status !== 'SYNCING' && (
                 <div className="mt-8 flex items-center gap-2 px-4 py-2 bg-gray-50 rounded-full border border-gray-200 text-sm text-gray-500">
                    <Activity size={16} />
                    <span>Último respaldo: <strong>{lastSync.toLocaleTimeString()}</strong></span>
                 </div>
              )}
           </div>

           {/* ACTIONS & DETAILS GRID */}
           <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Left: Pending Queue / Server Info */}
              <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-200">
                 {status === 'OFFLINE' || pendingItems > 0 ? (
                    <div className="h-full flex flex-col">
                       <div className="flex items-center gap-3 mb-4 text-orange-600">
                          <div className="p-2 bg-orange-100 rounded-lg"><Database size={20} /></div>
                          <h3 className="font-bold text-lg">Cola de Subida</h3>
                       </div>
                       
                       <div className="flex-1 bg-orange-50/50 rounded-xl p-4 border border-orange-100 mb-4">
                          <div className="flex justify-between items-center mb-2">
                             <span className="text-sm font-medium text-gray-700 flex items-center gap-2"><FileText size={14}/> Tickets de Venta</span>
                             <span className="font-bold text-orange-600">{pendingItems} pendientes</span>
                          </div>
                          <div className="flex justify-between items-center">
                             <span className="text-sm font-medium text-gray-700 flex items-center gap-2"><Server size={14}/> Logs de Sistema</span>
                             <span className="font-bold text-orange-600">2 pendientes</span>
                          </div>
                       </div>
                       
                       <p className="text-xs text-gray-400 mt-auto">
                          * Los datos se almacenan de forma segura en el dispositivo hasta recuperar la conexión.
                       </p>
                    </div>
                 ) : (
                    <div className="h-full flex flex-col">
                       <div className="flex items-center gap-3 mb-4 text-emerald-700">
                          <div className="p-2 bg-emerald-100 rounded-lg"><ShieldCheck size={20} /></div>
                          <h3 className="font-bold text-lg">Estado del Sistema</h3>
                       </div>
                       
                       <div className="space-y-4">
                          <div className="flex justify-between items-center border-b border-gray-100 pb-2">
                             <span className="text-sm text-gray-500">Latencia (Ping)</span>
                             <span className="font-mono font-bold text-emerald-600">{latency} ms</span>
                          </div>
                          <div className="flex justify-between items-center border-b border-gray-100 pb-2">
                             <span className="text-sm text-gray-500">Servidor</span>
                             <span className="font-bold text-gray-700">AWS us-east-1</span>
                          </div>
                          <div className="flex justify-between items-center">
                             <span className="text-sm text-gray-500">Versión App</span>
                             <span className="font-mono text-gray-700">v2.4.0 (Stable)</span>
                          </div>
                       </div>
                    </div>
                 )}
              </div>

              {/* Right: Actions */}
              <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-200 flex flex-col justify-between">
                 <div>
                    <h3 className="font-bold text-lg text-gray-800 mb-2">Acciones Manuales</h3>
                    <p className="text-sm text-gray-500 mb-6">Utiliza estas opciones si notas discrepancias en los datos.</p>
                 </div>

                 <div className="space-y-3">
                    <button 
                       onClick={handleForceSync}
                       disabled={status === 'SYNCING'}
                       className="w-full py-4 bg-slate-900 text-white rounded-xl font-bold flex items-center justify-center gap-3 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg active:scale-95 transition-all"
                    >
                       <RefreshCw size={20} className={status === 'SYNCING' ? 'animate-spin' : ''} />
                       {status === 'SYNCING' ? 'Sincronizando...' : 'Forzar Sincronización Completa'}
                    </button>
                    
                    {status === 'OFFLINE' && (
                       <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-xl text-xs font-bold justify-center">
                          <AlertTriangle size={14} />
                          Verifique su conexión WiFi o Ethernet
                       </div>
                    )}
                 </div>
              </div>

           </div>

        </div>
      </div>
    </div>
  );
};

export default SyncStatusHub;
