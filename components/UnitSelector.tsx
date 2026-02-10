
import React, { useState, useEffect } from 'react';
import { Plus, Check, X } from 'lucide-react';
import { UnitDefinition, BusinessConfig } from '../types';

interface UnitSelectorProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    config: BusinessConfig;
    onConfigUpdate: (newConfig: BusinessConfig) => void;
}

const DEFAULT_UNITS: UnitDefinition[] = [
    { code: 'un', name: 'Unidad', type: 'UNIT' },
    { code: 'kg', name: 'Kilogramo', type: 'MASS' },
    { code: 'gr', name: 'Gramo', type: 'MASS' },
    { code: 'lb', name: 'Libra', type: 'MASS' },
    { code: 'oz', name: 'Onza', type: 'MASS' },
    { code: 'lt', name: 'Litro', type: 'VOLUME' },
    { code: 'ml', name: 'Mililitro', type: 'VOLUME' },
    { code: 'gal', name: 'Galón', type: 'VOLUME' },
    { code: 'caja', name: 'Caja', type: 'UNIT' },
    { code: 'saco', name: 'Saco', type: 'UNIT' },
    { code: 'paq', name: 'Paquete', type: 'UNIT' },
    { code: 'bot', name: 'Botella', type: 'UNIT' }
];

export const UnitSelector: React.FC<UnitSelectorProps> = ({
    label, value, onChange, config, onConfigUpdate
}) => {
    const [isAddingNew, setIsAddingNew] = useState(false);
    const [newUnitCode, setNewUnitCode] = useState('');
    const [newUnitName, setNewUnitName] = useState('');

    // Merge default units with config units, ensuring no duplicates by code
    const availableUnits = React.useMemo(() => {
        const customUnits = config.units || [];
        // If config units are empty, we might want to seed them, 
        // but for display we merge defaults + custom
        // A map by code ensures uniqueness
        const map = new Map<string, UnitDefinition>();

        // Defaults first
        DEFAULT_UNITS.forEach(u => map.set(u.code.toLowerCase(), u));

        // Config overrides defaults if same code (or adds new)
        customUnits.forEach(u => map.set(u.code.toLowerCase(), u));

        return Array.from(map.values());
    }, [config.units]);

    const handleAddNew = async () => {
        if (!newUnitCode || !newUnitName) return;

        const newUnit: UnitDefinition = {
            code: newUnitCode.trim(),
            name: newUnitName.trim(),
            type: 'UNIT' // Default type
        };

        const currentCustomUnits = config.units || [];
        const updatedCustomUnits = [...currentCustomUnits, newUnit];

        // Optimistic Update
        const updatedConfig = { ...config, units: updatedCustomUnits };
        onConfigUpdate(updatedConfig);

        // Persist to Backend
        try {
            await fetch('/api/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedConfig)
            });

            // Select the new unit
            onChange(newUnit.code);
            setIsAddingNew(false);
            setNewUnitCode('');
            setNewUnitName('');
        } catch (error) {
            console.error('Failed to save new unit:', error);
            alert('Error al guardar la unidad');
        }
    };

    return (
        <div>
            <label className="block text-[10px] font-black text-gray-500 uppercase mb-1 ml-1">{label}</label>

            {!isAddingNew ? (
                <div className="flex gap-2">
                    <select
                        value={value}
                        onChange={e => {
                            if (e.target.value === '__ADD_NEW__') {
                                setIsAddingNew(true);
                            } else {
                                onChange(e.target.value);
                            }
                        }}
                        className="w-full p-3 bg-gray-50 border-2 border-transparent rounded-xl text-sm font-medium focus:bg-white focus:border-blue-200 cursor-pointer"
                    >
                        <option value="">Seleccionar...</option>
                        {availableUnits.map(u => (
                            <option key={u.code} value={u.code}>
                                {u.name} ({u.code})
                            </option>
                        ))}
                        <option disabled>──────────</option>
                        <option value="__ADD_NEW__" className="font-bold text-blue-600">+ Crear Nueva Unidad</option>
                    </select>
                </div>
            ) : (
                <div className="bg-blue-50 p-2 rounded-xl border border-blue-100 flex gap-2 items-center animate-in fade-in zoom-in-95 duration-200">
                    <input
                        autoFocus
                        type="text"
                        placeholder="Cód (ej: box)"
                        value={newUnitCode}
                        onChange={e => setNewUnitCode(e.target.value)}
                        className="w-20 p-2 text-xs border rounded-lg"
                    />
                    <input
                        type="text"
                        placeholder="Nombre (ej: Caja)"
                        value={newUnitName}
                        onChange={e => setNewUnitName(e.target.value)}
                        className="flex-1 p-2 text-xs border rounded-lg"
                    />
                    <button
                        onClick={handleAddNew}
                        disabled={!newUnitCode || !newUnitName}
                        className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                        <Check size={14} />
                    </button>
                    <button
                        onClick={() => setIsAddingNew(false)}
                        className="p-2 text-gray-500 hover:bg-gray-200 rounded-lg"
                    >
                        <X size={14} />
                    </button>
                </div>
            )}
        </div>
    );
}
