import React from 'react';
import { AlertTriangle, X, ShieldAlert, Check } from 'lucide-react';

interface SafetyGateModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    actionName: string; // e.g., "Cierre Z", "Salir"
    isCritical?: boolean; // True if ticket has items (double confirm)
    description?: string;
}

const SafetyGateModal: React.FC<SafetyGateModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    actionName,
    isCritical = false,
    description
}) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 border border-gray-100">
                {/* Header */}
                <div className={`p-6 flex flex-col items-center text-center ${isCritical ? 'bg-red-50' : 'bg-amber-50'}`}>
                    <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-4 shadow-sm ${isCritical ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
                        {isCritical ? <ShieldAlert size={32} strokeWidth={2} /> : <AlertTriangle size={32} strokeWidth={2} />}
                    </div>
                    <h3 className={`text-xl font-black uppercase tracking-tight ${isCritical ? 'text-red-900' : 'text-amber-900'}`}>
                        ¿{actionName}?
                    </h3>
                    <p className={`text-sm font-medium mt-2 leading-relaxed ${isCritical ? 'text-red-700' : 'text-amber-800'}`}>
                        {description || (isCritical
                            ? "Hay una venta en curso. Si continúas, podrías perder los datos actuales."
                            : "Se cerrará la sesión operativa actual.")}
                    </p>
                </div>

                {/* Actions */}
                <div className="p-4 bg-white">
                    {isCritical && (
                        <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3">
                            <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={16} />
                            <p className="text-xs text-red-700 font-bold">
                                Esta acción es irreversible. Confirma que deseas abandonar la venta actual.
                            </p>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                        <button
                            onClick={onClose}
                            className="py-3.5 px-4 rounded-xl border border-gray-200 text-gray-700 font-bold hover:bg-gray-50 active:scale-95 transition-all text-sm"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={() => {
                                onConfirm();
                                onClose();
                            }}
                            className={`py-3.5 px-4 rounded-xl text-white font-black shadow-lg active:scale-95 transition-all text-sm flex items-center justify-center gap-2 ${isCritical
                                    ? 'bg-red-600 hover:bg-red-700 shadow-red-200'
                                    : 'bg-slate-900 hover:bg-slate-800 shadow-slate-200'
                                }`}
                        >
                            <Check size={18} strokeWidth={3} />
                            Confirmar
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SafetyGateModal;
