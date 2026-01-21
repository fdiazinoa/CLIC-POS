import React, { useEffect } from 'react';
import { ArrowRight, Check, Wand2 } from 'lucide-react';

interface Step2MappingProps {
    headers: string[];
    entityType: 'PRODUCT' | 'CUSTOMER' | 'SUPPLIER' | 'INVENTORY';
    mapping: { [key: string]: string };
    setMapping: (mapping: { [key: string]: string }) => void;
}

import { SYSTEM_FIELDS } from '../../constants/importFields';

const Step2Mapping: React.FC<Step2MappingProps> = ({ headers, entityType, mapping, setMapping }) => {
    const fields = SYSTEM_FIELDS[entityType];

    // Auto-mapping logic
    useEffect(() => {
        const newMapping = { ...mapping };
        let changed = false;

        fields.forEach(field => {
            if (!newMapping[field.id]) {
                // Try exact match
                const exactMatch = headers.find(h => h.toLowerCase() === field.id.toLowerCase() || h.toLowerCase() === field.label.toLowerCase());
                if (exactMatch) {
                    newMapping[field.id] = exactMatch;
                    changed = true;
                }
            }
        });

        if (changed) {
            setMapping(newMapping);
        }
    }, [headers, entityType]);

    const handleMapChange = (fieldId: string, header: string) => {
        setMapping({
            ...mapping,
            [fieldId]: header
        });
    };

    const handleAutoMatch = () => {
        const newMapping = { ...mapping };
        let changed = false;

        fields.forEach(field => {
            // Try exact match or partial match if not already mapped
            const bestMatch = headers.find(h =>
                h.toLowerCase() === field.id.toLowerCase() ||
                h.toLowerCase() === field.label.toLowerCase() ||
                h.toLowerCase().includes(field.id.toLowerCase()) ||
                field.label.toLowerCase().includes(h.toLowerCase())
            );

            if (bestMatch) {
                newMapping[field.id] = bestMatch;
                changed = true;
            }
        });

        if (changed) {
            setMapping(newMapping);
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
            <div className="text-center mb-8">
                <h2 className="text-2xl font-bold text-gray-900">Mapeo de Columnas</h2>
                <p className="text-gray-500">Relaciona las columnas de tu archivo con los campos del sistema.</p>
                <button
                    onClick={handleAutoMatch}
                    className="mt-4 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg font-bold text-sm hover:bg-blue-100 transition-colors flex items-center gap-2 mx-auto"
                >
                    <Wand2 size={16} />
                    Auto-Match Campos
                </button>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="grid grid-cols-12 bg-gray-50 p-4 border-b border-gray-200 text-xs font-bold text-gray-500 uppercase tracking-wider">
                    <div className="col-span-5">Campo del Sistema</div>
                    <div className="col-span-2 text-center"><ArrowRight size={16} className="mx-auto" /></div>
                    <div className="col-span-5">Columna del Archivo</div>
                </div>

                <div className="divide-y divide-gray-100">
                    {fields.map((field) => {
                        const isMapped = !!mapping[field.id];
                        return (
                            <div key={field.id} className={`grid grid-cols-12 p-4 items-center hover:bg-gray-50 transition-colors ${isMapped ? 'bg-blue-50/30' : ''}`}>
                                <div className="col-span-5">
                                    <p className="font-bold text-gray-900 text-sm flex items-center gap-2">
                                        {field.label}
                                        {field.required && <span className="text-red-500 text-xs" title="Requerido">*</span>}
                                        {isMapped && <Check size={14} className="text-emerald-500" />}
                                    </p>
                                    <p className="text-xs text-gray-400 font-mono">{field.id}</p>
                                </div>

                                <div className="col-span-2 flex justify-center">
                                    <div className={`h-0.5 w-full ${isMapped ? 'bg-blue-200' : 'bg-gray-200'}`}></div>
                                </div>

                                <div className="col-span-5">
                                    <select
                                        value={mapping[field.id] || ''}
                                        onChange={(e) => handleMapChange(field.id, e.target.value)}
                                        className={`w-full p-2.5 rounded-lg border text-sm outline-none focus:ring-2 transition-all ${isMapped
                                            ? 'border-blue-300 bg-white focus:ring-blue-500/20 text-gray-900'
                                            : 'border-gray-200 bg-gray-50 focus:ring-gray-200 text-gray-500'
                                            }`}
                                    >
                                        <option value="">-- Ignorar --</option>
                                        {headers.map(h => (
                                            <option key={h} value={h}>{h}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default Step2Mapping;
