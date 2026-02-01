
import React, { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, XCircle, AlertCircle, Database, Server } from 'lucide-react';

export interface SyncModuleStatus {
    id: string;
    label: string;
    status: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'ERROR';
    message?: string;
    count?: number;
}

interface SyncProgressModalProps {
    isOpen: boolean;
    onClose: () => void;
    modules: SyncModuleStatus[];
}

const SyncProgressModal: React.FC<SyncProgressModalProps> = ({ isOpen, onClose, modules }) => {
    if (!isOpen) return null;

    const isComplete = modules.every(m => m.status === 'SUCCESS' || m.status === 'ERROR');
    const hasErrors = modules.some(m => m.status === 'ERROR');

    return (
        <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">

                {/* Header */}
                <div className="p-6 bg-gray-50 border-b border-gray-100 flex items-center gap-4">
                    <div className={`p-3 rounded-2xl ${isComplete ? (hasErrors ? 'bg-orange-100 text-orange-600' : 'bg-green-100 text-green-600') : 'bg-blue-100 text-blue-600'}`}>
                        {isComplete ? (hasErrors ? <AlertCircle size={24} /> : <CheckCircle2 size={24} />) : <Loader2 size={24} className="animate-spin" />}
                    </div>
                    <div>
                        <h3 className="text-xl font-black text-gray-800">
                            {isComplete ? 'Restauración Finalizada' : 'Restaurando Datos...'}
                        </h3>
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                            {isComplete ? (hasErrors ? 'Proceso completado con advertencias' : 'Proceso exitoso') : 'Sincronizando con Servidor'}
                        </p>
                    </div>
                </div>

                {/* Module List */}
                <div className="p-6 space-y-4">
                    {modules.map((module) => (
                        <div key={module.id} className="flex items-center justify-between group">
                            <div className="flex items-center gap-3">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 ${module.status === 'SUCCESS' ? 'bg-green-100 text-green-600' :
                                        module.status === 'ERROR' ? 'bg-red-100 text-red-600' :
                                            module.status === 'PROCESSING' ? 'bg-blue-100 text-blue-600' :
                                                'bg-gray-100 text-gray-300'
                                    }`}>
                                    {module.status === 'SUCCESS' && <CheckCircle2 size={16} strokeWidth={3} />}
                                    {module.status === 'ERROR' && <XCircle size={16} strokeWidth={3} />}
                                    {module.status === 'PROCESSING' && <Loader2 size={16} className="animate-spin" />}
                                    {module.status === 'PENDING' && <Database size={16} />}
                                </div>
                                <div>
                                    <p className={`font-bold text-sm ${module.status === 'PENDING' ? 'text-gray-400' : 'text-gray-800'
                                        }`}>{module.label}</p>
                                    {module.message && (
                                        <p className={`text-[10px] font-medium ${module.status === 'ERROR' ? 'text-red-500' : 'text-gray-400'
                                            }`}>{module.message}</p>
                                    )}
                                </div>
                            </div>
                            {module.count !== undefined && module.status === 'SUCCESS' && (
                                <span className="px-2 py-1 bg-gray-100 rounded-md text-[10px] font-black text-gray-600">
                                    {module.count} items
                                </span>
                            )}
                        </div>
                    ))}
                </div>

                {/* Footer */}
                <div className="p-4 bg-gray-50 border-t border-gray-100">
                    <button
                        onClick={onClose}
                        disabled={!isComplete}
                        className={`w-full py-3 rounded-xl font-bold transition-all ${isComplete
                                ? 'bg-gray-900 text-white hover:bg-gray-800 shadow-lg active:scale-95'
                                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                            }`}
                    >
                        {isComplete ? 'Cerrar y Recargar' : 'Por favor espere...'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SyncProgressModal;
