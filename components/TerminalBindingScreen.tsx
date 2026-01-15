
import React, { useState } from 'react';
import { 
  Monitor, ShieldCheck, Lock, ChevronRight, 
  Smartphone, AlertCircle, CheckCircle2, User, KeyRound
} from 'lucide-react';
import { BusinessConfig, User as UserType } from '../types';

interface TerminalBindingScreenProps {
  config: BusinessConfig;
  deviceId: string;
  adminUsers: UserType[];
  onPair: (terminalId: string) => void;
}

const TerminalBindingScreen: React.FC<TerminalBindingScreenProps> = ({ config, deviceId, adminUsers, onPair }) => {
  const [step, setStep] = useState<'AUTH' | 'SELECT' | 'CONFLICT'>('AUTH');
  const [adminPin, setAdminPin] = useState('');
  const [selectedTerminalId, setSelectedTerminalId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // AUTH LOGIC
  const handleAuth = () => {
    const admin = adminUsers.find(u => u.pin === adminPin && u.role === 'ADMIN');
    if (admin) {
      setStep('SELECT');
      setError(null);
    } else {
      setError('PIN de Administrador inválido');
      setAdminPin('');
    }
  };

  const handleSelectTerminal = (tId: string) => {
    const terminal = config.terminals.find(t => t.id === tId);
    if (terminal?.config.currentDeviceId && terminal.config.currentDeviceId !== deviceId) {
      setSelectedTerminalId(tId);
      setStep('CONFLICT');
    } else {
      onPair(tId);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6 relative overflow-hidden">
      {/* Background Decor */}
      <div className="absolute inset-0 opacity-10 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-blue-500 rounded-full blur-[160px]"></div>
      </div>

      <div className="max-w-md w-full bg-white rounded-[2.5rem] shadow-2xl p-10 z-10 animate-in zoom-in-95 duration-300">
        <div className="text-center mb-8">
           <div className="w-20 h-20 bg-blue-50 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-inner">
             <Smartphone className="text-blue-600" size={40} />
           </div>
           <h1 className="text-2xl font-black text-slate-800">Vinculación de Terminal</h1>
           <p className="text-slate-400 text-sm mt-2 font-medium">Este dispositivo no ha sido autorizado.</p>
        </div>

        {/* STEP 1: ADMIN AUTH */}
        {step === 'AUTH' && (
          <div className="space-y-6 animate-in slide-in-from-bottom-4">
             <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                <div className="flex items-center gap-2 mb-4 text-slate-500">
                   <Lock size={16} />
                   <span className="text-[10px] font-bold uppercase tracking-widest">Autorización Requerida</span>
                </div>
                <input 
                  type="password" 
                  placeholder="PIN de Administrador" 
                  value={adminPin}
                  maxLength={4}
                  onChange={e => setAdminPin(e.target.value)}
                  className="w-full p-4 bg-white border-2 border-slate-200 rounded-xl text-center text-2xl font-mono tracking-[1rem] outline-none focus:border-blue-500 transition-all"
                />
                {error && <p className="text-red-500 text-xs mt-3 font-bold text-center">{error}</p>}
             </div>
             <button 
               onClick={handleAuth}
               className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black text-lg shadow-xl shadow-blue-200 hover:bg-blue-700 active:scale-95 transition-all flex items-center justify-center gap-2"
             >
               Continuar <ChevronRight size={20} />
             </button>
          </div>
        )}

        {/* STEP 2: SELECT TERMINAL */}
        {step === 'SELECT' && (
          <div className="space-y-4 animate-in fade-in">
             <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Selecciona una posición:</p>
             <div className="space-y-3">
                {config.terminals.map(t => (
                  <button 
                    key={t.id}
                    onClick={() => handleSelectTerminal(t.id)}
                    className="w-full p-4 bg-slate-50 border-2 border-transparent hover:border-blue-400 hover:bg-white rounded-2xl flex items-center justify-between group transition-all"
                  >
                    <div className="flex items-center gap-4">
                       <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-slate-400 group-hover:text-blue-600 shadow-sm transition-colors">
                          <Monitor size={20} />
                       </div>
                       <div className="text-left">
                          <h4 className="font-bold text-slate-800">{t.id}</h4>
                          <p className="text-[10px] text-slate-400 font-bold uppercase">
                             {t.config.currentDeviceId ? 'Ocupada' : 'Disponible'}
                          </p>
                       </div>
                    </div>
                    {t.config.currentDeviceId && <Lock size={16} className="text-slate-300" />}
                  </button>
                ))}
             </div>
          </div>
        )}

        {/* STEP 3: CONFLICT RESOLUTION */}
        {step === 'CONFLICT' && (
           <div className="space-y-6 animate-in zoom-in-95">
              <div className="bg-orange-50 border-2 border-orange-100 p-6 rounded-3xl">
                 <AlertCircle className="text-orange-500 mx-auto mb-4" size={48} />
                 <h3 className="text-center font-bold text-orange-800">Terminal ya en uso</h3>
                 <p className="text-center text-orange-700 text-xs mt-2 leading-relaxed">
                    La terminal <strong>{selectedTerminalId}</strong> está vinculada a otro hardware. 
                    Si continúas, desvincularás el dispositivo anterior.
                 </p>
              </div>

              <div className="flex flex-col gap-3">
                 <button 
                   onClick={() => onPair(selectedTerminalId!)}
                   className="w-full py-4 bg-orange-500 text-white rounded-2xl font-black shadow-lg hover:bg-orange-600 transition-all"
                 >
                    Desvincular anterior y Tomar Control
                 </button>
                 <button 
                   onClick={() => setStep('SELECT')}
                   className="w-full py-4 text-slate-500 font-bold hover:bg-slate-100 rounded-2xl"
                 >
                    Elegir otra terminal
                 </button>
              </div>
           </div>
        )}

        <div className="mt-10 pt-6 border-t border-slate-100 text-center">
           <p className="text-[10px] text-slate-300 font-mono">Fingerprint: {deviceId.substring(0,18)}...</p>
        </div>
      </div>
    </div>
  );
};

export default TerminalBindingScreen;
