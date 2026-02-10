
import React, { useState, useEffect } from 'react';
import { Calculator, ArrowRight, Check, X, RotateCcw } from 'lucide-react';
import { getSuggestedFactor, getUnitType } from '../utils/unitConversions';

interface ConversionHelperProps {
    fromUnit: string; // Purchase Unit (e.g. Saco)
    toUnit: string;   // Base Unit (e.g. lb)
    currentFactor: number;
    onApply: (factor: number) => void;
    onClose: () => void;
}

export const ConversionHelper: React.FC<ConversionHelperProps> = ({
    fromUnit, toUnit, currentFactor, onApply, onClose
}) => {
    const [manualValue, setManualValue] = useState<string>('');
    const [suggestion, setSuggestion] = useState<number | null>(null);

    useEffect(() => {
        const suggested = getSuggestedFactor(fromUnit, toUnit);
        if (suggested) {
            setSuggestion(Number(suggested.toFixed(4)));
        }
    }, [fromUnit, toUnit]);

    const handleManualApply = () => {
        const val = parseFloat(manualValue);
        if (!isNaN(val) && val > 0) {
            onApply(val);
            onClose();
        }
    };

    const hasSuggestion = suggestion !== null;

    return (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl shadow-xl w-full max-w-md overflow-hidden">
                <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                    <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <Calculator className="text-blue-600" size={20} />
                        Asistente de Conversión
                    </h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    {/* Header Context */}
                    <div className="text-center p-4 bg-blue-50 rounded-2xl border border-blue-100">
                        <p className="text-xs font-bold text-gray-500 uppercase mb-2">Objetivo</p>
                        <div className="flex items-center justify-center gap-4 text-xl font-bold text-gray-800">
                            <div className="flex flex-col items-center">
                                <span className="text-3xl text-blue-600">1</span>
                                <span className="text-xs text-gray-400">{fromUnit || '?'}</span>
                            </div>
                            <ArrowRight className="text-gray-300" />
                            <div className="flex flex-col items-center">
                                <span className="text-3xl text-green-600">{manualValue || suggestion || currentFactor || '?'}</span>
                                <span className="text-xs text-gray-400">{toUnit || '?'}</span>
                            </div>
                        </div>
                    </div>

                    {/* Smart Suggestion */}
                    {hasSuggestion && (
                        <div className="space-y-2">
                            <p className="text-xs font-bold text-gray-500 uppercase ml-1">Sugerencia Estándar</p>
                            <button
                                onClick={() => onApply(suggestion!)}
                                className="w-full flex items-center justify-between p-4 bg-green-50 border-2 border-green-100 hover:border-green-300 rounded-xl transition-all group text-left"
                            >
                                <div>
                                    <p className="font-bold text-green-800">Usar Estandar: {suggestion}</p>
                                    <p className="text-xs text-green-600">
                                        1 {fromUnit} equivale exactamente a {suggestion} {toUnit}
                                    </p>
                                </div>
                                <div className="bg-white rounded-full p-2 text-green-600 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Check size={16} />
                                </div>
                            </button>
                        </div>
                    )}

                    {/* Manual Input / Calculator */}
                    <div className="space-y-3">
                        <div className="flex justify-between items-center">
                            <label className="text-xs font-bold text-gray-500 uppercase ml-1">
                                {hasSuggestion ? 'O ingresa otro valor' : 'Cálculo Manual'}
                            </label>
                        </div>

                        <p className="text-sm text-gray-600">
                            ¿Cuántos <b>{toUnit}</b> contiene 1 <b>{fromUnit}</b>?
                        </p>

                        <div className="flex gap-2">
                            <input
                                autoFocus
                                type="number"
                                placeholder="Ej: 24"
                                value={manualValue}
                                onChange={e => setManualValue(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleManualApply()}
                                className="flex-1 p-4 bg-gray-50 border-2 border-transparent focus:bg-white focus:border-blue-200 rounded-xl text-lg font-bold outline-none"
                            />
                            <button
                                onClick={handleManualApply}
                                disabled={!manualValue}
                                className="bg-blue-600 text-white px-6 rounded-xl font-bold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                Aplicar
                            </button>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
};
