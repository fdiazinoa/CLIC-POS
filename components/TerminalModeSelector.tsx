import React from 'react';
import { ArrowRight, MonitorSmartphone, Server, Wifi } from 'lucide-react';

interface TerminalModeSelectorProps {
    onSelect: (mode: 'SERVER' | 'CLIENT') => void;
}

const TerminalModeSelector: React.FC<TerminalModeSelectorProps> = ({ onSelect }) => {
    return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 overflow-hidden relative">
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/20 blur-[120px] rounded-full" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-cyan-500/15 blur-[120px] rounded-full" />

            <div className="relative z-10 w-full max-w-3xl">
                <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-[2.5rem] shadow-2xl p-8 md:p-10">
                    <div className="text-center mb-8">
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-blue-600 to-cyan-500 shadow-lg shadow-blue-500/20 mb-5">
                            <MonitorSmartphone className="text-white" size={34} />
                        </div>
                        <h1 className="text-3xl md:text-4xl font-black text-white mb-3">Modo del Dispositivo</h1>
                        <p className="text-slate-400 max-w-xl mx-auto">
                            Defina si este equipo será el servidor principal con base local o una caja cliente conectada a otro servidor.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <button
                            type="button"
                            onClick={() => onSelect('SERVER')}
                            className="group text-left rounded-[2rem] border border-slate-800 bg-slate-950/70 hover:bg-slate-900 p-6 transition-all hover:border-blue-500/50 hover:-translate-y-0.5"
                        >
                            <div className="w-14 h-14 rounded-2xl bg-blue-600/15 text-blue-400 flex items-center justify-center mb-5 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                                <Server size={26} />
                            </div>
                            <h2 className="text-2xl font-black text-white mb-2">Servidor</h2>
                            <p className="text-slate-400 text-sm leading-relaxed mb-6">
                                Instala el sistema completo en esta unidad y crea la base local para operar como caja principal.
                            </p>
                            <div className="inline-flex items-center gap-2 text-blue-300 font-bold">
                                Configurar como servidor <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                            </div>
                        </button>

                        <button
                            type="button"
                            onClick={() => onSelect('CLIENT')}
                            className="group text-left rounded-[2rem] border border-slate-800 bg-slate-950/70 hover:bg-slate-900 p-6 transition-all hover:border-cyan-500/50 hover:-translate-y-0.5"
                        >
                            <div className="w-14 h-14 rounded-2xl bg-cyan-500/15 text-cyan-300 flex items-center justify-center mb-5 group-hover:bg-cyan-500 group-hover:text-slate-950 transition-colors">
                                <Wifi size={26} />
                            </div>
                            <h2 className="text-2xl font-black text-white mb-2">Cliente</h2>
                            <p className="text-slate-400 text-sm leading-relaxed mb-6">
                                Busca la IP del servidor master y vincula este equipo como terminal adicional en la red local.
                            </p>
                            <div className="inline-flex items-center gap-2 text-cyan-300 font-bold">
                                Vincular a un servidor <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                            </div>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TerminalModeSelector;
