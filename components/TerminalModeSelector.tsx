import React from 'react';
import { ArrowRight, MonitorSmartphone, Server, Wifi, Building2, ClipboardList } from 'lucide-react';

interface TerminalModeSelectorProps {
    onSelect: (mode: 'SERVER_LOCAL' | 'SERVER_ERP' | 'CLIENT' | 'ORDER_TAKER') => void;
}

const TerminalModeSelector: React.FC<TerminalModeSelectorProps> = ({ onSelect }) => {
    return (
        <div className="h-full min-h-0 overflow-y-auto bg-slate-950 relative overscroll-y-contain">
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/20 blur-[120px] rounded-full" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-cyan-500/15 blur-[120px] rounded-full" />

            <div className="relative z-10 flex min-h-full w-full items-start justify-center p-3 sm:p-6 lg:items-center">
                <div className="w-full max-w-3xl bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-[1.75rem] sm:rounded-[2.5rem] shadow-2xl p-4 sm:p-8 md:p-10">
                    <div className="text-center mb-5 sm:mb-8">
                        <div className="inline-flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 rounded-2xl sm:rounded-3xl bg-gradient-to-br from-blue-600 to-cyan-500 shadow-lg shadow-blue-500/20 mb-3 sm:mb-5">
                            <MonitorSmartphone className="text-white" size={34} />
                        </div>
                        <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white mb-2 sm:mb-3">Modo del Dispositivo</h1>
                        <p className="text-sm sm:text-base text-slate-400 max-w-xl mx-auto">
                            Define si este equipo operará como caja maestra local, caja maestra conectada al ERP o terminal esclava de otra caja.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:gap-5 md:grid-cols-2">
                        <button
                            type="button"
                            onClick={() => onSelect('SERVER_LOCAL')}
                            className="group text-left rounded-[1.5rem] sm:rounded-[2rem] border border-slate-800 bg-slate-950/70 hover:bg-slate-900 p-4 sm:p-6 transition-all hover:border-blue-500/50 hover:-translate-y-0.5"
                        >
                            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-blue-600/15 text-blue-400 flex items-center justify-center mb-3 sm:mb-5 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                                <Server size={26} />
                            </div>
                            <h2 className="text-xl sm:text-2xl font-black text-white mb-2">Master Local</h2>
                            <p className="text-slate-400 text-sm leading-relaxed mb-4 sm:mb-6">
                                Opera localmente en esta unidad. Puede funcionar sola o servir de maestra para otras cajas sin depender del ERP.
                            </p>
                            <div className="inline-flex items-center gap-2 text-blue-300 font-bold">
                                Configurar modo local <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                            </div>
                        </button>

                        <button
                            type="button"
                            onClick={() => onSelect('SERVER_ERP')}
                            className="group text-left rounded-[1.5rem] sm:rounded-[2rem] border border-slate-800 bg-slate-950/70 hover:bg-slate-900 p-4 sm:p-6 transition-all hover:border-emerald-500/50 hover:-translate-y-0.5"
                        >
                            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-emerald-500/15 text-emerald-300 flex items-center justify-center mb-3 sm:mb-5 group-hover:bg-emerald-500 group-hover:text-slate-950 transition-colors">
                                <Building2 size={26} />
                            </div>
                            <h2 className="text-xl sm:text-2xl font-black text-white mb-2">Master + ERP</h2>
                            <p className="text-slate-400 text-sm leading-relaxed mb-4 sm:mb-6">
                                Esta caja se vincula directo con el ERP. Puede operar sola o ser la maestra que sincroniza hacia el ERP.
                            </p>
                            <div className="inline-flex items-center gap-2 text-emerald-300 font-bold">
                                Vincular con ERP <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                            </div>
                        </button>

                        <button
                            type="button"
                            onClick={() => onSelect('CLIENT')}
                            className="group text-left rounded-[1.5rem] sm:rounded-[2rem] border border-slate-800 bg-slate-950/70 hover:bg-slate-900 p-4 sm:p-6 transition-all hover:border-cyan-500/50 hover:-translate-y-0.5"
                        >
                            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-cyan-500/15 text-cyan-300 flex items-center justify-center mb-3 sm:mb-5 group-hover:bg-cyan-500 group-hover:text-slate-950 transition-colors">
                                <Wifi size={26} />
                            </div>
                            <h2 className="text-xl sm:text-2xl font-black text-white mb-2">Cliente</h2>
                            <p className="text-slate-400 text-sm leading-relaxed mb-4 sm:mb-6">
                                Se conecta a una caja maestra existente dentro de la red local para operar como terminal adicional.
                            </p>
                            <div className="inline-flex items-center gap-2 text-cyan-300 font-bold">
                                Vincular a una maestra <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                            </div>
                        </button>

                        <button
                            type="button"
                            onClick={() => onSelect('ORDER_TAKER')}
                            className="group text-left rounded-[1.5rem] sm:rounded-[2rem] border border-slate-800 bg-slate-950/70 hover:bg-slate-900 p-4 sm:p-6 transition-all hover:border-violet-500/50 hover:-translate-y-0.5"
                        >
                            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-violet-500/15 text-violet-300 flex items-center justify-center mb-3 sm:mb-5 group-hover:bg-violet-500 group-hover:text-white transition-colors">
                                <ClipboardList size={26} />
                            </div>
                            <h2 className="text-xl sm:text-2xl font-black text-white mb-2">Toma de pedidos</h2>
                            <p className="text-slate-400 text-sm leading-relaxed mb-4 sm:mb-6">
                                Tablet o estación para mesas y comandas. Se conecta a una caja maestra y no procesa cobros.
                            </p>
                            <div className="inline-flex items-center gap-2 text-violet-300 font-bold">
                                Vincular toma de pedidos <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                            </div>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TerminalModeSelector;
