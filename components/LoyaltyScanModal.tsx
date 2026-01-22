import React, { useState } from 'react';
import { X, CreditCard, Search, Check } from 'lucide-react';

interface LoyaltyScanModalProps {
    onClose: () => void;
    onScan: (code: string) => void;
}

const LoyaltyScanModal: React.FC<LoyaltyScanModalProps> = ({ onClose, onScan }) => {
    const [code, setCode] = useState('');

    const handleScan = () => {
        if (!code.trim()) return;
        onScan(code.trim());
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-6">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-xl font-black text-gray-800 flex items-center gap-2">
                            <CreditCard className="text-blue-600" />
                            Tarjeta de Lealtad
                        </h3>
                        <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-400">
                            <X size={20} />
                        </button>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Número de Tarjeta</label>
                            <div className="relative">
                                <input
                                    autoFocus
                                    type="text"
                                    value={code}
                                    onChange={(e) => setCode(e.target.value)}
                                    className="w-full text-center text-2xl font-black tracking-widest p-4 pl-12 bg-gray-50 border-2 border-gray-200 rounded-xl outline-none focus:border-blue-500 focus:bg-white transition-all placeholder-gray-300"
                                    placeholder="Escanea o digita..."
                                    onKeyDown={(e) => e.key === 'Enter' && handleScan()}
                                />
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={24} />
                            </div>
                        </div>

                        <button
                            onClick={handleScan}
                            disabled={!code.trim()}
                            className="w-full py-4 bg-blue-600 text-white rounded-xl font-bold text-lg shadow-lg hover:bg-blue-700 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Check size={20} />
                            Buscar y Asignar
                        </button>
                    </div>
                </div>
                <div className="bg-gray-50 p-4 text-center">
                    <p className="text-xs text-gray-400 font-medium">
                        Escanea el código de barras o QR de la tarjeta física o digital.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default LoyaltyScanModal;
